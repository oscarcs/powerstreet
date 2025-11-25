import * as THREE from "three";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { constructPolygonMeshObject } from "../geometry/constructPolygonMeshObject";
import { PolygonCoords } from "../geometry/types";
import { LocalStore } from "../data/createLocalStore";

export class BuildingManager {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private localStore: LocalStore | null = null;
    private buildingMeshes: Map<string, THREE.Mesh> = new Map();
    private originalMaterials: Map<string, THREE.Material> = new Map();
    private selectedBuildingId: string | null = null;
    private selectionListenerId: string | null = null;
    private nodeListenerId: string | null = null;

    constructor(scene: THREE.Scene, store: WorldsyncStore) {
        this.scene = scene;
        this.store = store;
        this.initialize();
    }

    public setLocalStore(localStore: LocalStore): void {
        this.localStore = localStore;
        this.selectionListenerId = this.localStore.addValueListener(
            "selectedBuildingId",
            (_store, _valueId, newValue) => {
                this.updateSelection(newValue as string | undefined);
            },
        );
        // Apply initial selection state
        const initialSelection = this.localStore.getValue("selectedBuildingId");
        if (initialSelection) {
            this.updateSelection(initialSelection as string);
        }
    }

    private updateSelection(newBuildingId: string | undefined): void {
        // Restore previous selection to solid
        if (this.selectedBuildingId) {
            const prevMesh = this.buildingMeshes.get(this.selectedBuildingId);
            const prevOriginal = this.originalMaterials.get(this.selectedBuildingId);
            if (prevMesh && prevOriginal) {
                if (!Array.isArray(prevMesh.material)) {
                    prevMesh.material.dispose();
                }
                prevMesh.material = prevOriginal;
            }
        }

        this.selectedBuildingId = newBuildingId ?? null;

        // Apply semi-transparent material to new selection
        if (this.selectedBuildingId) {
            const mesh = this.buildingMeshes.get(this.selectedBuildingId);
            if (mesh && !Array.isArray(mesh.material)) {
                const originalMaterial = mesh.material as THREE.MeshLambertMaterial;
                // Store original if not already stored
                if (!this.originalMaterials.has(this.selectedBuildingId)) {
                    this.originalMaterials.set(this.selectedBuildingId, originalMaterial);
                }
                // Create semi-transparent copy
                const selectedMaterial = new THREE.MeshLambertMaterial({
                    color: originalMaterial.color,
                    transparent: true,
                    opacity: 0.5,
                });
                mesh.material = selectedMaterial;
            }
        }
    }

    public getBuildingMeshes(): THREE.Mesh[] {
        return Array.from(this.buildingMeshes.values());
    }

    public getBuildingMesh(buildingId: string): THREE.Mesh | undefined {
        return this.buildingMeshes.get(buildingId);
    }

    public getBuildingIdFromMesh(mesh: THREE.Object3D): string | null {
        return (mesh.userData.buildingId as string) ?? null;
    }

    private initialize() {
        this.store.getRowIds("buildings").forEach((buildingId) => {
            this.createBuilding(buildingId);
        });

        this.store.addRowListener("buildings", null, (_store, _tableId, rowId) => {
            if (rowId) {
                this.createBuilding(rowId);
            }
        });

        // Listen for node coordinate changes to rebuild affected buildings
        this.nodeListenerId = this.store.addCellListener(
            "nodes",
            null,
            null,
            (_store, _tableId, rowId, cellId) => {
                if (cellId === "x" || cellId === "z") {
                    const row = this.store.getRow("nodes", rowId);
                    if (row && row.bldgId) {
                        this.createBuilding(row.bldgId as string);
                    }
                }
            },
        );
    }

    private createBuilding(buildingId: string) {
        if (this.buildingMeshes.has(buildingId)) {
            const mesh = this.buildingMeshes.get(buildingId);
            if (mesh) {
                this.scene.remove(mesh);
                mesh.geometry.dispose();
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((m) => m.dispose());
                } else {
                    mesh.material.dispose();
                }
                this.buildingMeshes.delete(buildingId);
            }
        }

        const building = this.store.getRow("buildings", buildingId);
        if (!building) return;

        const nodes: { x: number; z: number; idx: number }[] = [];
        this.store.getRowIds("nodes").forEach((rowId) => {
            const row = this.store.getRow("nodes", rowId);
            if (row.bldgId === buildingId) {
                nodes.push({ x: row.x as number, z: row.z as number, idx: row.idx as number });
            }
        });

        nodes.sort((a, b) => a.idx - b.idx);

        if (nodes.length < 3) return;

        // Negate Z to handle rotation later
        const loop = nodes.map((n) => [n.x, -n.z] as [number, number]);
        if (loop.length > 0) {
            loop.push([...loop[0]]);
        }
        const polygon: PolygonCoords = [loop];

        const floorHeight = (building.floorHeight as number) || 3;
        const floorCount = (building.floorCount as number) || 1;
        const height = floorHeight * floorCount;
        const baseElevation = (building.baseElevation as number) || 0;
        const color = (building.color as string) || "#ffffff";

        const mesh = constructPolygonMeshObject([polygon], {
            thickness: height,
            offset: baseElevation,
            flat: true,
        });

        const material = new THREE.MeshLambertMaterial({ color: color });
        mesh.material = material;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.buildingId = buildingId;

        // Store original material for selection restoration
        this.originalMaterials.set(buildingId, material);

        // If this building is currently selected, apply the semi-transparent material
        if (this.selectedBuildingId === buildingId) {
            const selectedMaterial = new THREE.MeshLambertMaterial({
                color: material.color,
                transparent: true,
                opacity: 0.5,
            });
            mesh.material = selectedMaterial;
        }

        // Rotate to align with world coordinates (Y-up)
        mesh.rotation.x = -Math.PI / 2;

        // Fix position to match world coordinates
        const { x, y, z } = mesh.position;
        mesh.position.set(x, z, -y);

        this.buildingMeshes.set(buildingId, mesh);
        this.scene.add(mesh);
    }

    public dispose() {
        if (this.selectionListenerId && this.localStore) {
            this.localStore.delListener(this.selectionListenerId);
        }
        if (this.nodeListenerId) {
            this.store.delListener(this.nodeListenerId);
        }
        this.buildingMeshes.forEach((mesh) => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach((m) => m.dispose());
            } else {
                mesh.material.dispose();
            }
        });
        this.buildingMeshes.clear();
        this.originalMaterials.clear();
    }
}
