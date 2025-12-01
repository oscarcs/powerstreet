import * as THREE from "three";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { Line2NodeMaterial } from "three/webgpu";
import {
    WorldsyncStore,
    getSectionBaseElevation,
    getSortedBuildingSections,
} from "../../shared/WorldsyncStore";
import { LocalStore } from "../data/createLocalStore";
import { isPolygonSelfIntersecting } from "../geometry/PolygonValidation";

const HANDLE_RADIUS = 0.3;
const HANDLE_COLOR = 0x4a90d9;
const HANDLE_HOVER_COLOR = 0x7ab8f5;
const HANDLE_DRAG_COLOR = 0xffa500;
const OUTLINE_COLOR = 0x4a90d9;
const OUTLINE_HEIGHT_OFFSET = 0.05;
const OUTLINE_LINE_WIDTH = 3;

interface NodeData {
    rowId: string;
    x: number;
    z: number;
    idx: number;
}

interface SectionData {
    sectionId: string;
    sectionIdx: number;
    computedBaseElevation: number;
    height: number;
}

export class EditGizmoManager {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private localStore: LocalStore | null = null;

    // Gizmo objects
    private handleMeshes: Map<string, THREE.Mesh> = new Map(); // nodeRowId -> mesh
    private outlineLine: Line2 | null = null;
    private outlineGeometry: LineGeometry | null = null;
    private outlineMaterial: Line2NodeMaterial;

    // Materials
    private handleMaterial: THREE.MeshBasicMaterial;
    private handleHoverMaterial: THREE.MeshBasicMaterial;
    private handleDragMaterial: THREE.MeshBasicMaterial;
    private handleGeometry: THREE.SphereGeometry;

    // State
    private editingBuildingId: string | null = null;
    private editingSectionId: string | null = null;
    private hoveredNodeId: string | null = null;
    private draggingNodeId: string | null = null;
    private dragStartPosition: THREE.Vector3 = new THREE.Vector3();
    private originalNodePositions: Map<string, { x: number; z: number }> = new Map();

    // Listeners
    private toolListenerId: string | null = null;
    private selectionListenerId: string | null = null;
    private sectionSelectionListenerId: string | null = null;
    private editingListenerId: string | null = null;
    private editingSectionListenerId: string | null = null;

    constructor(scene: THREE.Scene, store: WorldsyncStore) {
        this.scene = scene;
        this.store = store;

        // Create shared materials
        this.handleMaterial = new THREE.MeshBasicMaterial({ color: HANDLE_COLOR });
        this.handleHoverMaterial = new THREE.MeshBasicMaterial({ color: HANDLE_HOVER_COLOR });
        this.handleDragMaterial = new THREE.MeshBasicMaterial({ color: HANDLE_DRAG_COLOR });
        this.outlineMaterial = new Line2NodeMaterial({
            color: OUTLINE_COLOR,
            linewidth: OUTLINE_LINE_WIDTH,
        });
        this.handleGeometry = new THREE.SphereGeometry(HANDLE_RADIUS, 16, 16);
    }

    public setLocalStore(localStore: LocalStore): void {
        this.localStore = localStore;

        // Listen for tool changes
        this.toolListenerId = this.localStore.addValueListener(
            "currentTool",
            (_store, _valueId, newValue) => {
                this.checkEditMode(
                    newValue as string | undefined,
                    this.localStore?.getValue("selectedBuildingId") as string | undefined,
                    this.localStore?.getValue("selectedSectionId") as string | undefined,
                );
            },
        );

        // Listen for building selection changes
        this.selectionListenerId = this.localStore.addValueListener(
            "selectedBuildingId",
            (_store, _valueId, newValue) => {
                this.checkEditMode(
                    this.localStore?.getValue("currentTool") as string | undefined,
                    newValue as string | undefined,
                    this.localStore?.getValue("selectedSectionId") as string | undefined,
                );
            },
        );

        // Listen for section selection changes
        this.sectionSelectionListenerId = this.localStore.addValueListener(
            "selectedSectionId",
            (_store, _valueId, newValue) => {
                this.checkEditMode(
                    this.localStore?.getValue("currentTool") as string | undefined,
                    this.localStore?.getValue("selectedBuildingId") as string | undefined,
                    newValue as string | undefined,
                );
            },
        );

        // Listen for editing state changes (to handle external updates)
        this.editingListenerId = this.localStore.addValueListener(
            "editingBuildingId",
            (_store, _valueId, newValue) => {
                const editingId = newValue as string | undefined;
                if (editingId !== this.editingBuildingId) {
                    if (editingId) {
                        const sectionId = this.localStore?.getValue("editingSectionId") as
                            | string
                            | undefined;
                        this.enterEditMode(editingId, sectionId);
                    } else {
                        this.exitEditMode();
                    }
                }
            },
        );

        // Listen for editing section changes
        this.editingSectionListenerId = this.localStore.addValueListener(
            "editingSectionId",
            (_store, _valueId, newValue) => {
                const sectionId = newValue as string | undefined;
                if (sectionId !== this.editingSectionId && this.editingBuildingId) {
                    // Re-enter edit mode with new section
                    this.enterEditMode(this.editingBuildingId, sectionId);
                }
            },
        );

        // Check initial state
        const initialTool = this.localStore.getValue("currentTool") as string | undefined;
        const initialSelection = this.localStore.getValue("selectedBuildingId") as
            | string
            | undefined;
        const initialSection = this.localStore.getValue("selectedSectionId") as string | undefined;
        this.checkEditMode(initialTool, initialSelection, initialSection);
    }

    private getSectionsForBuilding(buildingId: string): SectionData[] {
        return getSortedBuildingSections(this.store, buildingId);
    }

    private checkEditMode(
        currentTool: string | undefined,
        selectedBuildingId: string | undefined,
        selectedSectionId: string | undefined,
    ): void {
        const shouldBeEditing = currentTool === "building" && selectedBuildingId !== undefined;

        if (shouldBeEditing) {
            const buildingChanged = selectedBuildingId !== this.editingBuildingId;
            const sectionChanged = selectedSectionId !== this.editingSectionId;

            if (buildingChanged || sectionChanged) {
                // Determine which section to edit
                let sectionToEdit = selectedSectionId;

                // If no section selected or section doesn't belong to this building, pick the first one
                if (!sectionToEdit || buildingChanged) {
                    const sections = this.getSectionsForBuilding(selectedBuildingId);
                    if (sections.length > 0) {
                        sectionToEdit = sections[0].sectionId;
                        this.localStore?.setValue("selectedSectionId", sectionToEdit);
                    }
                }

                this.localStore?.setValue("editingBuildingId", selectedBuildingId);
                if (sectionToEdit) {
                    this.localStore?.setValue("editingSectionId", sectionToEdit);
                }
                this.enterEditMode(selectedBuildingId, sectionToEdit);
            }
        } else if (!shouldBeEditing && this.editingBuildingId) {
            // Exit edit mode
            this.localStore?.delValue("editingBuildingId");
            this.localStore?.delValue("editingSectionId");
            this.exitEditMode();
        }
    }

    private enterEditMode(buildingId: string, sectionId: string | undefined): void {
        this.exitEditMode(); // Clean up any existing edit state
        this.editingBuildingId = buildingId;
        this.editingSectionId = sectionId ?? null;

        if (sectionId) {
            this.createGizmos(sectionId);
        }
    }

    private exitEditMode(): void {
        this.clearGizmos();
        this.editingBuildingId = null;
        this.editingSectionId = null;
        this.hoveredNodeId = null;
        this.draggingNodeId = null;
        this.originalNodePositions.clear();
    }

    private getNodesForSection(sectionId: string): NodeData[] {
        const nodes: NodeData[] = [];
        this.store.getRowIds("nodes").forEach((rowId) => {
            const row = this.store.getRow("nodes", rowId);
            if (row.sectionId === sectionId) {
                nodes.push({
                    rowId,
                    x: row.x as number,
                    z: row.z as number,
                    idx: row.idx as number,
                });
            }
        });
        nodes.sort((a, b) => a.idx - b.idx);
        return nodes;
    }

    private createGizmos(sectionId: string): void {
        const section = this.store.getRow("sections", sectionId);
        if (!section) return;

        const nodes = this.getNodesForSection(sectionId);
        if (nodes.length < 3) return;

        const baseElevation = getSectionBaseElevation(this.store, sectionId);

        // Store original positions for potential rollback
        nodes.forEach((node) => {
            this.originalNodePositions.set(node.rowId, { x: node.x, z: node.z });
        });

        // Create handle meshes at each vertex (in world space)
        nodes.forEach((node) => {
            const handle = new THREE.Mesh(this.handleGeometry, this.handleMaterial.clone());
            // Position in world space: x stays same, y is at base elevation, z stays same
            // (BuildingManager creates polygon with [n.x, -n.z], then rotates -PI/2 on X, resulting in world Z = n.z)
            handle.position.set(node.x, baseElevation + OUTLINE_HEIGHT_OFFSET, node.z);
            handle.userData.nodeRowId = node.rowId;
            handle.userData.isGizmoHandle = true;
            this.handleMeshes.set(node.rowId, handle);
            this.scene.add(handle);
        });

        // Create outline
        this.createOutline(nodes, baseElevation);
    }

    private createOutline(nodes: NodeData[], baseElevation: number): void {
        // Build positions array for LineGeometry (x, y, z for each point, closing the loop)
        const positions: number[] = [];
        nodes.forEach((node) => {
            positions.push(node.x, baseElevation + OUTLINE_HEIGHT_OFFSET, node.z);
        });
        // Close the loop by adding the first point again
        if (nodes.length > 0) {
            positions.push(nodes[0].x, baseElevation + OUTLINE_HEIGHT_OFFSET, nodes[0].z);
        }

        this.outlineGeometry = new LineGeometry();
        this.outlineGeometry.setPositions(positions);

        this.outlineLine = new Line2(this.outlineGeometry, this.outlineMaterial);
        this.outlineLine.computeLineDistances();
        this.scene.add(this.outlineLine);
    }

    private updateOutline(): void {
        if (!this.outlineLine || !this.editingSectionId) return;

        const baseElevation = getSectionBaseElevation(this.store, this.editingSectionId);

        const nodes = this.getNodesForSection(this.editingSectionId);

        // Build positions array
        const positions: number[] = [];
        nodes.forEach((node) => {
            positions.push(node.x, baseElevation + OUTLINE_HEIGHT_OFFSET, node.z);
        });
        // Close the loop
        if (nodes.length > 0) {
            positions.push(nodes[0].x, baseElevation + OUTLINE_HEIGHT_OFFSET, nodes[0].z);
        }

        if (this.outlineGeometry) {
            this.outlineGeometry.dispose();
        }
        this.outlineGeometry = new LineGeometry();
        this.outlineGeometry.setPositions(positions);
        this.outlineLine.geometry = this.outlineGeometry;
        this.outlineLine.computeLineDistances();
    }

    private clearGizmos(): void {
        // Remove handle meshes
        this.handleMeshes.forEach((mesh) => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            if (mesh.material instanceof THREE.Material) {
                mesh.material.dispose();
            }
        });
        this.handleMeshes.clear();

        // Remove outline
        if (this.outlineLine) {
            this.scene.remove(this.outlineLine);
            this.outlineLine.geometry.dispose();
            this.outlineLine = null;
        }
    }

    public getHandleMeshes(): THREE.Mesh[] {
        return Array.from(this.handleMeshes.values());
    }

    public isEditMode(): boolean {
        return this.editingBuildingId !== null;
    }

    public getEditingBuildingId(): string | null {
        return this.editingBuildingId;
    }

    public getEditingSectionBaseElevation(): number {
        if (!this.editingSectionId) return 0;
        return getSectionBaseElevation(this.store, this.editingSectionId);
    }

    public setHoveredNode(nodeRowId: string | null): void {
        // Reset previous hover
        if (this.hoveredNodeId && this.hoveredNodeId !== this.draggingNodeId) {
            const prevMesh = this.handleMeshes.get(this.hoveredNodeId);
            if (prevMesh) {
                (prevMesh.material as THREE.MeshBasicMaterial).color.setHex(HANDLE_COLOR);
            }
        }

        this.hoveredNodeId = nodeRowId;

        // Apply hover effect (unless dragging)
        if (nodeRowId && nodeRowId !== this.draggingNodeId) {
            const mesh = this.handleMeshes.get(nodeRowId);
            if (mesh) {
                (mesh.material as THREE.MeshBasicMaterial).color.setHex(HANDLE_HOVER_COLOR);
            }
        }
    }

    public startDrag(nodeRowId: string, worldPosition: THREE.Vector3): void {
        this.draggingNodeId = nodeRowId;
        this.dragStartPosition.copy(worldPosition);
        this.localStore?.setValue("draggingNodeId", nodeRowId);

        const mesh = this.handleMeshes.get(nodeRowId);
        if (mesh) {
            (mesh.material as THREE.MeshBasicMaterial).color.setHex(HANDLE_DRAG_COLOR);
        }
    }

    public updateDrag(worldPosition: THREE.Vector3): void {
        if (!this.draggingNodeId) return;

        const mesh = this.handleMeshes.get(this.draggingNodeId);
        if (mesh) {
            // Update mesh position (world space)
            mesh.position.x = worldPosition.x;
            mesh.position.z = worldPosition.z;

            // Update outline in real-time by temporarily modifying node data
            this.updateOutlineWithDragPosition(worldPosition);
        }
    }

    private updateOutlineWithDragPosition(worldPosition: THREE.Vector3): void {
        if (!this.outlineLine || !this.editingSectionId || !this.draggingNodeId) return;

        const baseElevation = getSectionBaseElevation(this.store, this.editingSectionId);

        const nodes = this.getNodesForSection(this.editingSectionId);

        // Build positions array with the dragged node's new position
        const positions: number[] = [];
        nodes.forEach((node) => {
            if (node.rowId === this.draggingNodeId) {
                positions.push(
                    worldPosition.x,
                    baseElevation + OUTLINE_HEIGHT_OFFSET,
                    worldPosition.z,
                );
            } else {
                positions.push(node.x, baseElevation + OUTLINE_HEIGHT_OFFSET, node.z);
            }
        });
        // Close the loop
        if (nodes.length > 0) {
            const firstNode = nodes[0];
            if (firstNode.rowId === this.draggingNodeId) {
                positions.push(
                    worldPosition.x,
                    baseElevation + OUTLINE_HEIGHT_OFFSET,
                    worldPosition.z,
                );
            } else {
                positions.push(firstNode.x, baseElevation + OUTLINE_HEIGHT_OFFSET, firstNode.z);
            }
        }

        if (this.outlineGeometry) {
            this.outlineGeometry.dispose();
        }
        this.outlineGeometry = new LineGeometry();
        this.outlineGeometry.setPositions(positions);
        this.outlineLine.geometry = this.outlineGeometry;
        this.outlineLine.computeLineDistances();
    }

    public endDrag(worldPosition: THREE.Vector3): boolean {
        if (!this.draggingNodeId || !this.editingSectionId) {
            this.draggingNodeId = null;
            this.localStore?.delValue("draggingNodeId");
            return false;
        }

        const nodeRowId = this.draggingNodeId;

        // Convert world position to store coordinates
        // World coords: (x, y, z) -> Store coords: (x, z) where storeX = worldX, storeZ = worldZ
        const newX = worldPosition.x;
        const newZ = worldPosition.z;

        // Validate the new polygon before saving
        if (!this.validateNewPosition(nodeRowId, newX, newZ)) {
            // Rollback to original position
            this.rollbackDrag();
            return false;
        }

        // Save to store
        this.store.setCell("nodes", nodeRowId, "x", newX);
        this.store.setCell("nodes", nodeRowId, "z", newZ);

        // Update stored original position
        this.originalNodePositions.set(nodeRowId, { x: newX, z: newZ });

        // Reset drag state
        const mesh = this.handleMeshes.get(nodeRowId);
        if (mesh) {
            (mesh.material as THREE.MeshBasicMaterial).color.setHex(HANDLE_COLOR);
        }

        this.draggingNodeId = null;
        this.localStore?.delValue("draggingNodeId");

        // Update outline with final position
        this.updateOutline();

        return true;
    }

    private validateNewPosition(nodeRowId: string, newX: number, newZ: number): boolean {
        if (!this.editingSectionId) return false;

        const nodes = this.getNodesForSection(this.editingSectionId);

        // Create polygon with the new position
        const polygon: [number, number][] = nodes.map((node) => {
            if (node.rowId === nodeRowId) {
                return [newX, newZ];
            }
            return [node.x, node.z];
        });

        // Check if polygon self-intersects
        return !isPolygonSelfIntersecting(polygon);
    }

    private rollbackDrag(): void {
        if (!this.draggingNodeId) return;

        const original = this.originalNodePositions.get(this.draggingNodeId);
        if (original) {
            const mesh = this.handleMeshes.get(this.draggingNodeId);
            if (mesh) {
                // Store coords are same as world coords for x/z
                mesh.position.x = original.x;
                mesh.position.z = original.z;
                (mesh.material as THREE.MeshBasicMaterial).color.setHex(HANDLE_COLOR);
            }
        }

        // Reset outline
        this.updateOutline();

        this.draggingNodeId = null;
        this.localStore?.delValue("draggingNodeId");
    }

    public cancelDrag(): void {
        this.rollbackDrag();
    }

    public getNodeRowIdFromMesh(mesh: THREE.Object3D): string | null {
        return (mesh.userData.nodeRowId as string) ?? null;
    }

    public isDragging(): boolean {
        return this.draggingNodeId !== null;
    }

    public dispose(): void {
        if (this.toolListenerId && this.localStore) {
            this.localStore.delListener(this.toolListenerId);
        }
        if (this.selectionListenerId && this.localStore) {
            this.localStore.delListener(this.selectionListenerId);
        }
        if (this.sectionSelectionListenerId && this.localStore) {
            this.localStore.delListener(this.sectionSelectionListenerId);
        }
        if (this.editingListenerId && this.localStore) {
            this.localStore.delListener(this.editingListenerId);
        }
        if (this.editingSectionListenerId && this.localStore) {
            this.localStore.delListener(this.editingSectionListenerId);
        }

        this.clearGizmos();

        // Dispose shared resources
        this.handleMaterial.dispose();
        this.handleHoverMaterial.dispose();
        this.handleDragMaterial.dispose();
        this.outlineMaterial.dispose();
        this.handleGeometry.dispose();
    }
}
