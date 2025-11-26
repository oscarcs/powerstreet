import * as THREE from "three";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { LocalStore } from "../data/createLocalStore";
import { LightmapManager } from "./LightmapManager";

export class BuildingManager {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private localStore: LocalStore | null = null;
    private buildingMeshes: Map<string, THREE.Mesh> = new Map();
    private originalMaterials: Map<string, THREE.Material> = new Map();
    private selectedBuildingId: string | null = null;
    private selectionListenerId: string | null = null;
    private nodeListenerId: string | null = null;
    private lightmapManager: LightmapManager | null = null;

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

    public setLightmapManager(lightmapManager: LightmapManager): void {
        this.lightmapManager = lightmapManager;

        // Register existing building meshes
        this.buildingMeshes.forEach((mesh, buildingId) => {
            this.lightmapManager?.registerMesh(`building_${buildingId}`, mesh);
        });
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
                // Re-register with lightmap when restoring solid material
                this.lightmapManager?.registerMesh(`building_${this.selectedBuildingId}`, prevMesh);
            }
        }

        this.selectedBuildingId = newBuildingId ?? null;

        // Apply semi-transparent material to new selection
        if (this.selectedBuildingId) {
            const mesh = this.buildingMeshes.get(this.selectedBuildingId);
            if (mesh && !Array.isArray(mesh.material)) {
                const originalMaterial = mesh.material as THREE.MeshPhongMaterial;
                // Store original if not already stored
                if (!this.originalMaterials.has(this.selectedBuildingId)) {
                    this.originalMaterials.set(this.selectedBuildingId, originalMaterial);
                }
                // Unregister from lightmap - transparent objects shouldn't be in lightmap
                this.lightmapManager?.unregisterMesh(`building_${this.selectedBuildingId}`);
                // Create semi-transparent copy
                const selectedMaterial = new THREE.MeshPhongMaterial({
                    color: originalMaterial.color,
                    transparent: true,
                    opacity: 0.5,
                    depthWrite: false, // Helps with transparency artifacts
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
                // Unregister from lightmap
                this.lightmapManager?.unregisterMesh(`building_${buildingId}`);

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

        const floorHeight = (building.floorHeight as number) || 3;
        const floorCount = (building.floorCount as number) || 1;
        const height = floorHeight * floorCount;
        const baseElevation = (building.baseElevation as number) || 0;
        const color = (building.color as string) || "#ffffff";

        // Create a THREE.Shape from the node coordinates
        // Negate Z to account for coordinate system transformation after rotation
        const shape = new THREE.Shape();
        shape.moveTo(nodes[0].x, -nodes[0].z);
        for (let i = 1; i < nodes.length; i++) {
            shape.lineTo(nodes[i].x, -nodes[i].z);
        }
        shape.closePath();

        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: height,
            bevelEnabled: false,
        });

        // Normalize UVs to 0-1 range for lightmap compatibility
        const uvAttr = geometry.getAttribute("uv");
        if (uvAttr) {
            let minU = Infinity,
                maxU = -Infinity;
            let minV = Infinity,
                maxV = -Infinity;

            // Find UV bounds
            for (let i = 0; i < uvAttr.count; i++) {
                const u = uvAttr.getX(i);
                const v = uvAttr.getY(i);
                minU = Math.min(minU, u);
                maxU = Math.max(maxU, u);
                minV = Math.min(minV, v);
                maxV = Math.max(maxV, v);
            }

            const rangeU = maxU - minU || 1;
            const rangeV = maxV - minV || 1;

            // Normalize to 0-1 range
            for (let i = 0; i < uvAttr.count; i++) {
                const u = uvAttr.getX(i);
                const v = uvAttr.getY(i);
                uvAttr.setXY(i, (u - minU) / rangeU, (v - minV) / rangeV);
            }
            uvAttr.needsUpdate = true;
        }

        const material = new THREE.MeshPhongMaterial({
            color: color,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.buildingId = buildingId;

        // Store original material for selection restoration
        this.originalMaterials.set(buildingId, material);

        // If this building is currently selected, apply the semi-transparent material
        if (this.selectedBuildingId === buildingId) {
            const selectedMaterial = new THREE.MeshPhongMaterial({
                color: material.color,
                transparent: true,
                opacity: 0.5,
            });
            mesh.material = selectedMaterial;
        }

        // ExtrudeGeometry extrudes along Z axis, we need Y-up
        // Rotate so the extrusion goes up (Y axis)
        mesh.rotation.x = -Math.PI / 2;

        // Position at base elevation
        mesh.position.y = baseElevation;

        this.buildingMeshes.set(buildingId, mesh);
        this.scene.add(mesh);

        // Register with lightmap manager
        this.lightmapManager?.registerMesh(`building_${buildingId}`, mesh);
    }

    public dispose() {
        if (this.selectionListenerId && this.localStore) {
            this.localStore.delListener(this.selectionListenerId);
        }
        if (this.nodeListenerId) {
            this.store.delListener(this.nodeListenerId);
        }
        this.buildingMeshes.forEach((mesh, buildingId) => {
            // Unregister from lightmap
            this.lightmapManager?.unregisterMesh(`building_${buildingId}`);

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
