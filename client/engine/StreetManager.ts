import * as THREE from "three";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { ExtrudePolyline, Vec2 } from "../geometry/ExtrudePolyline";
import { TileManager } from "../spatial/TileManager";
import { BoundingBox } from "../spatial/SpatialIndex";
import { SnapResult } from "./TransportGraphUtils";

interface EdgeData {
    id: string;
    startNodeId: string;
    endNodeId: string;
    width: number;
    color: number;
}

export interface PreviewOptions {
    snapResult?: SnapResult;
    isValid?: boolean;
}

export class StreetManager {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private streetGroup: THREE.Group;
    private edgeMeshes: Map<string, THREE.Object3D> = new Map(); // edgeId -> mesh
    private previewMesh: THREE.Mesh | null = null;
    private previewMaterial: THREE.MeshStandardMaterial;
    private invalidPreviewMaterial: THREE.MeshStandardMaterial;
    private tileManager: TileManager | null = null;

    // Snap indicator meshes
    private snapIndicatorGroup: THREE.Group;
    private nodeSnapIndicator: THREE.Mesh | null = null;
    private edgeSnapIndicator: THREE.Mesh | null = null;
    private edgeHighlightMesh: THREE.Mesh | null = null;

    constructor(scene: THREE.Scene, store: WorldsyncStore) {
        this.scene = scene;
        this.store = store;
        this.streetGroup = new THREE.Group();
        this.scene.add(this.streetGroup);

        this.snapIndicatorGroup = new THREE.Group();
        this.snapIndicatorGroup.name = "SnapIndicators";
        this.scene.add(this.snapIndicatorGroup);

        this.previewMaterial = new THREE.MeshStandardMaterial({
            color: 0x44aaff,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });

        this.invalidPreviewMaterial = new THREE.MeshStandardMaterial({
            color: 0xff4444,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });

        this.initialize();
    }

    public setTileManager(tileManager: TileManager): void {
        this.tileManager = tileManager;
        // Register existing edges with the tile manager
        this.updateTileManagerWithEdges();
    }

    /**
     * Calculate the bounding box of a street edge.
     */
    private calculateEdgeBounds(edgeId: string): BoundingBox | null {
        const edge = this.store.getRow("streetEdges", edgeId);
        if (!edge) return null;

        const startNode = this.store.getRow("streetNodes", edge.startNodeId as string);
        const endNode = this.store.getRow("streetNodes", edge.endNodeId as string);
        if (!startNode || !endNode) return null;

        const startX = startNode.x as number;
        const startZ = startNode.z as number;
        const endX = endNode.x as number;
        const endZ = endNode.z as number;
        const width = (edge.width as number) || 5;
        const halfWidth = width / 2;

        return {
            minX: Math.min(startX, endX) - halfWidth,
            minZ: Math.min(startZ, endZ) - halfWidth,
            maxX: Math.max(startX, endX) + halfWidth,
            maxZ: Math.max(startZ, endZ) + halfWidth,
        };
    }

    /**
     * Update the tile manager with all current edges.
     */
    private updateTileManagerWithEdges(): void {
        if (!this.tileManager) return;

        const edgeIds = this.store.getRowIds("streetEdges");
        for (const edgeId of edgeIds) {
            const bounds = this.calculateEdgeBounds(edgeId);
            if (bounds) {
                this.tileManager.updateEntity(edgeId, bounds);
            }
        }
    }

    private initialize(): void {
        // Initial build
        this.rebuildAllStreets();

        // Listen for changes
        // We listen to everything for now and rebuild all. 
        // Optimization: Listen to specific rows and update only affected edges.
        this.store.addRowListener("streetNodes", null, () => this.rebuildAllStreets());
        this.store.addRowListener("streetEdges", null, () => this.rebuildAllStreets());
        this.store.addRowListener("streetGroups", null, () => this.rebuildAllStreets());
        
        this.store.addCellListener("streetNodes", null, null, () => this.rebuildAllStreets());
        this.store.addCellListener("streetEdges", null, null, () => this.rebuildAllStreets());
        this.store.addCellListener("streetGroups", null, null, () => this.rebuildAllStreets());
    }

    private rebuildAllStreets(): void {
        // Clear existing
        this.streetGroup.clear();
        this.edgeMeshes.clear();

        const edgeIds = this.store.getRowIds("streetEdges");
        const edges: EdgeData[] = [];
        const adj = new Map<string, string[]>(); // nodeId -> edgeIds

        // 1. Gather Data & Build Adjacency
        edgeIds.forEach(id => {
            const row = this.store.getRow("streetEdges", id);
            if (!row) return;
            
            const startNodeId = row.startNodeId as string;
            const endNodeId = row.endNodeId as string;
            
            // Resolve color
            let color = 0xffffff;
            if (row.streetGroupId) {
                const group = this.store.getRow("streetGroups", row.streetGroupId as string);
                if (group && group.color) {
                    color = parseInt((group.color as string).replace("#", "0x"), 16);
                }
            }
            
            const edge: EdgeData = {
                id,
                startNodeId,
                endNodeId,
                width: (row.width as number) || 5,
                color
            };
            edges.push(edge);

            if (!adj.has(startNodeId)) adj.set(startNodeId, []);
            if (!adj.has(endNodeId)) adj.set(endNodeId, []);
            adj.get(startNodeId)!.push(id);
            adj.get(endNodeId)!.push(id);
        });

        const edgeMap = new Map(edges.map(e => [e.id, e]));
        const visited = new Set<string>();

        // 2. Build Polylines
        for (const startEdge of edges) {
            if (visited.has(startEdge.id)) continue;

            // Start a new polyline
            visited.add(startEdge.id);
            
            const points: string[] = [startEdge.startNodeId, startEdge.endNodeId]; // Node IDs
            const polylineEdges: string[] = [startEdge.id];
            
            // Grow Forward (from endNode)
            let currNodeId = startEdge.endNodeId;
            let prevEdgeId = startEdge.id;
            
            while (true) {
                const connectedEdges = adj.get(currNodeId);
                if (!connectedEdges || connectedEdges.length !== 2) break; // Junction or endpoint
                
                const nextEdgeId = connectedEdges.find(id => id !== prevEdgeId);
                if (!nextEdgeId) break;
                
                if (visited.has(nextEdgeId)) break; // Cycle closed or already visited
                
                const nextEdge = edgeMap.get(nextEdgeId)!;
                
                // Check properties
                const prevEdge = edgeMap.get(prevEdgeId)!;
                if (nextEdge.width !== prevEdge.width || nextEdge.color !== prevEdge.color) break;
                
                // Add to polyline
                visited.add(nextEdgeId);
                polylineEdges.push(nextEdgeId);
                
                // Determine next node
                const nextNodeId = nextEdge.startNodeId === currNodeId ? nextEdge.endNodeId : nextEdge.startNodeId;
                points.push(nextNodeId);
                
                prevEdgeId = nextEdgeId;
                currNodeId = nextNodeId;
            }
            
            // Grow Backward (from startNode)
            currNodeId = startEdge.startNodeId;
            prevEdgeId = startEdge.id;
            
            while (true) {
                const connectedEdges = adj.get(currNodeId);
                if (!connectedEdges || connectedEdges.length !== 2) break;
                
                const nextEdgeId = connectedEdges.find(id => id !== prevEdgeId);
                if (!nextEdgeId) break;
                
                if (visited.has(nextEdgeId)) break;
                
                const nextEdge = edgeMap.get(nextEdgeId)!;
                const prevEdge = edgeMap.get(prevEdgeId)!;
                
                if (nextEdge.width !== prevEdge.width || nextEdge.color !== prevEdge.color) break;
                
                visited.add(nextEdgeId);
                polylineEdges.unshift(nextEdgeId);
                
                const nextNodeId = nextEdge.startNodeId === currNodeId ? nextEdge.endNodeId : nextEdge.startNodeId;
                points.unshift(nextNodeId);
                
                prevEdgeId = nextEdgeId;
                currNodeId = nextNodeId;
            }
            
            // 3. Create Mesh
            this.createPolylineMesh(points, startEdge.width, startEdge.color, polylineEdges);
        }

        // Update tile manager with edge bounds
        this.updateTileManagerWithEdges();
    }

    private createPolylineMesh(nodeIds: string[], width: number, color: number, edgeIds: string[]): void {
        const points: Vec2[] = [];
        for (const nodeId of nodeIds) {
            const node = this.store.getRow("streetNodes", nodeId);
            if (node) {
                points.push([node.x as number, node.z as number]);
            }
        }
        
        if (points.length < 2) return;

        const extruder = new ExtrudePolyline({
            thickness: width,
            cap: "square",
            join: "miter",
            miterLimit: 3
        });
        
        const meshData = extruder.build(points);
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        geometry.computeVertexNormals();
        
        // Lift slightly
        geometry.translate(0, 0.1, 0);

        const material = new THREE.MeshStandardMaterial({ 
            color: color,
            side: THREE.DoubleSide,
            roughness: 0.9,
            metalness: 0.1
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        mesh.userData = { edgeIds, type: 'streetPolyline' };
        
        this.streetGroup.add(mesh);
        
        // Map edges to this mesh
        edgeIds.forEach(id => this.edgeMeshes.set(id, mesh));
    }

    public updatePreview(
        start: THREE.Vector3,
        end: THREE.Vector3,
        width: number,
        options: PreviewOptions = {}
    ): void {
        this.clearPreview();

        const { snapResult, isValid = true } = options;

        // Use snapped position if available
        const endPos = snapResult && snapResult.type !== "none"
            ? new THREE.Vector3(snapResult.position.x, 0, snapResult.position.z)
            : end;

        const points: Vec2[] = [
            [start.x, start.z],
            [endPos.x, endPos.z]
        ];

        const extruder = new ExtrudePolyline({
            thickness: width,
            cap: "square",
            join: "miter"
        });

        const meshData = extruder.build(points);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        geometry.computeVertexNormals();

        // Lift slightly higher than regular streets to appear above
        geometry.translate(0, 0.15, 0);

        // Use red material if invalid (crossing), blue if valid
        const material = isValid ? this.previewMaterial : this.invalidPreviewMaterial;
        this.previewMesh = new THREE.Mesh(geometry, material);
        this.streetGroup.add(this.previewMesh);

        // Show snap indicators
        this.updateSnapIndicators(snapResult);
    }

    /**
     * Update snap indicator visuals based on snap result.
     */
    private updateSnapIndicators(snapResult?: SnapResult): void {
        this.clearSnapIndicators();

        if (!snapResult || snapResult.type === "none") {
            return;
        }

        const { x, z } = snapResult.position;

        if (snapResult.type === "node") {
            // Show ring around node
            const ringGeometry = new THREE.RingGeometry(1.5, 2.5, 32);
            ringGeometry.rotateX(-Math.PI / 2);
            const ringMaterial = new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide,
            });
            this.nodeSnapIndicator = new THREE.Mesh(ringGeometry, ringMaterial);
            this.nodeSnapIndicator.position.set(x, 0.2, z);
            this.snapIndicatorGroup.add(this.nodeSnapIndicator);
        } else if (snapResult.type === "edge" && snapResult.edgeId) {
            // Show dot at snap point
            const dotGeometry = new THREE.CircleGeometry(1, 16);
            dotGeometry.rotateX(-Math.PI / 2);
            const dotMaterial = new THREE.MeshBasicMaterial({
                color: 0xffff00,
                transparent: true,
                opacity: 0.9,
            });
            this.edgeSnapIndicator = new THREE.Mesh(dotGeometry, dotMaterial);
            this.edgeSnapIndicator.position.set(x, 0.25, z);
            this.snapIndicatorGroup.add(this.edgeSnapIndicator);

            // Highlight the edge that would be split
            this.highlightEdge(snapResult.edgeId);
        }
    }

    /**
     * Highlight an edge that would be split.
     */
    private highlightEdge(edgeId: string): void {
        const edge = this.store.getRow("streetEdges", edgeId);
        if (!edge) return;

        const startNode = this.store.getRow("streetNodes", edge.startNodeId as string);
        const endNode = this.store.getRow("streetNodes", edge.endNodeId as string);
        if (!startNode || !endNode) return;

        const width = ((edge.width as number) || 5) + 2; // Slightly wider than edge

        const points: Vec2[] = [
            [startNode.x as number, startNode.z as number],
            [endNode.x as number, endNode.z as number]
        ];

        const extruder = new ExtrudePolyline({
            thickness: width,
            cap: "square",
            join: "miter"
        });

        const meshData = extruder.build(points);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        geometry.computeVertexNormals();
        geometry.translate(0, 0.12, 0); // Between street and preview

        const material = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
        });

        this.edgeHighlightMesh = new THREE.Mesh(geometry, material);
        this.snapIndicatorGroup.add(this.edgeHighlightMesh);
    }

    /**
     * Clear snap indicator meshes.
     */
    private clearSnapIndicators(): void {
        if (this.nodeSnapIndicator) {
            this.snapIndicatorGroup.remove(this.nodeSnapIndicator);
            this.nodeSnapIndicator.geometry.dispose();
            (this.nodeSnapIndicator.material as THREE.Material).dispose();
            this.nodeSnapIndicator = null;
        }
        if (this.edgeSnapIndicator) {
            this.snapIndicatorGroup.remove(this.edgeSnapIndicator);
            this.edgeSnapIndicator.geometry.dispose();
            (this.edgeSnapIndicator.material as THREE.Material).dispose();
            this.edgeSnapIndicator = null;
        }
        if (this.edgeHighlightMesh) {
            this.snapIndicatorGroup.remove(this.edgeHighlightMesh);
            this.edgeHighlightMesh.geometry.dispose();
            (this.edgeHighlightMesh.material as THREE.Material).dispose();
            this.edgeHighlightMesh = null;
        }
    }

    public clearPreview(): void {
        if (this.previewMesh) {
            this.streetGroup.remove(this.previewMesh);
            this.previewMesh.geometry.dispose();
            this.previewMesh = null;
        }
        this.clearSnapIndicators();
    }

    public dispose(): void {
        this.clearPreview();
        this.previewMaterial.dispose();
        this.invalidPreviewMaterial.dispose();
        this.scene.remove(this.streetGroup);
        this.scene.remove(this.snapIndicatorGroup);
        this.streetGroup.clear();
        this.edgeMeshes.clear();
    }
}
