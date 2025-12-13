import * as THREE from "three";
import { WorldsyncStore } from "../../shared/WorldsyncStore";

export class StreetManager {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private streetGroup: THREE.Group;
    private edgeMeshes: Map<string, THREE.Object3D> = new Map(); // edgeId -> mesh
    private previewMesh: THREE.Mesh | null = null;
    private previewMaterial: THREE.MeshStandardMaterial;

    constructor(scene: THREE.Scene, store: WorldsyncStore) {
        this.scene = scene;
        this.store = store;
        this.streetGroup = new THREE.Group();
        this.scene.add(this.streetGroup);

        this.previewMaterial = new THREE.MeshStandardMaterial({
            color: 0x44aaff,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });

        this.initialize();
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
        
        edgeIds.forEach(edgeId => {
            const edge = this.store.getRow("streetEdges", edgeId);
            const startNode = this.store.getRow("streetNodes", edge.startNodeId as string);
            const endNode = this.store.getRow("streetNodes", edge.endNodeId as string);

            if (startNode && endNode) {
                const start = new THREE.Vector3(startNode.x as number, 0, startNode.z as number);
                const end = new THREE.Vector3(endNode.x as number, 0, endNode.z as number);
                const width = (edge.width as number) || 5;

                // Get color from group if available
                let color = 0xffffff;
                if (edge.streetGroupId) {
                    const group = this.store.getRow("streetGroups", edge.streetGroupId as string);
                    if (group && group.color) {
                        color = parseInt((group.color as string).replace("#", "0x"), 16);
                    }
                }

                const mesh = this.createStreetMesh(start, end, width, color);
                mesh.userData = { edgeId, type: 'streetEdge' };
                
                this.streetGroup.add(mesh);
                this.edgeMeshes.set(edgeId, mesh);
            }
        });
    }

    private createStreetMesh(start: THREE.Vector3, end: THREE.Vector3, width: number, color: number): THREE.Mesh {
        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        const perp = new THREE.Vector3(-direction.z, 0, direction.x);
        const halfWidth = width / 2;
        
        const v1 = new THREE.Vector3().copy(start).addScaledVector(perp, halfWidth);
        const v2 = new THREE.Vector3().copy(start).addScaledVector(perp, -halfWidth);
        const v3 = new THREE.Vector3().copy(end).addScaledVector(perp, halfWidth);
        const v4 = new THREE.Vector3().copy(end).addScaledVector(perp, -halfWidth);
        
        // Lift slightly to avoid z-fighting
        const yOffset = 0.1;
        v1.y += yOffset;
        v2.y += yOffset;
        v3.y += yOffset;
        v4.y += yOffset;

        const vertices = new Float32Array([
            v1.x, v1.y, v1.z,
            v3.x, v3.y, v3.z,
            v2.x, v2.y, v2.z,
            
            v3.x, v3.y, v3.z,
            v4.x, v4.y, v4.z,
            v2.x, v2.y, v2.z
        ]);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshStandardMaterial({ 
            color: color,
            side: THREE.DoubleSide,
            roughness: 0.9,
            metalness: 0.1
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        return mesh;
    }

    public updatePreview(start: THREE.Vector3, end: THREE.Vector3, width: number): void {
        this.clearPreview();

        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        const perp = new THREE.Vector3(-direction.z, 0, direction.x);
        const halfWidth = width / 2;
        
        const v1 = new THREE.Vector3().copy(start).addScaledVector(perp, halfWidth);
        const v2 = new THREE.Vector3().copy(start).addScaledVector(perp, -halfWidth);
        const v3 = new THREE.Vector3().copy(end).addScaledVector(perp, halfWidth);
        const v4 = new THREE.Vector3().copy(end).addScaledVector(perp, -halfWidth);
        
        // Lift slightly higher than regular streets to appear above
        const yOffset = 0.15;
        v1.y += yOffset;
        v2.y += yOffset;
        v3.y += yOffset;
        v4.y += yOffset;

        const vertices = new Float32Array([
            v1.x, v1.y, v1.z,
            v3.x, v3.y, v3.z,
            v2.x, v2.y, v2.z,
            
            v3.x, v3.y, v3.z,
            v4.x, v4.y, v4.z,
            v2.x, v2.y, v2.z
        ]);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        
        this.previewMesh = new THREE.Mesh(geometry, this.previewMaterial);
        this.streetGroup.add(this.previewMesh);
    }

    public clearPreview(): void {
        if (this.previewMesh) {
            this.streetGroup.remove(this.previewMesh);
            this.previewMesh.geometry.dispose();
            this.previewMesh = null;
        }
    }

    public dispose(): void {
        this.clearPreview();
        this.previewMaterial.dispose();
        this.scene.remove(this.streetGroup);
        this.streetGroup.clear();
        this.edgeMeshes.clear();
    }
}
