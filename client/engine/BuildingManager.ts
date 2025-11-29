import * as THREE from "three";
import { WorldsyncStore, getSortedBuildingSections } from "../../shared/WorldsyncStore";
import { LocalStore } from "../data/createLocalStore";
import { LightmapManager } from "./LightmapManager";

interface SectionData {
    sectionId: string;
    sectionIdx: number;
    computedBaseElevation: number;
    height: number;
    color: string;
}

interface NodeData {
    x: number;
    z: number;
    idx: number;
}

export class BuildingManager {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private localStore: LocalStore | null = null;
    private buildingGroups: Map<string, THREE.Group> = new Map();
    private sectionMeshes: Map<string, THREE.Mesh> = new Map(); // sectionId -> mesh
    private originalMaterials: Map<string, THREE.Material> = new Map();
    private selectedBuildingId: string | null = null;
    private selectionListenerId: string | null = null;
    private nodeListenerId: string | null = null;
    private sectionListenerId: string | null = null;
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

        // Register existing section meshes
        this.sectionMeshes.forEach((mesh, sectionId) => {
            this.lightmapManager?.registerMesh(`section_${sectionId}`, mesh);
        });
    }

    private updateSelection(newBuildingId: string | undefined): void {
        // Restore previous selection to solid
        if (this.selectedBuildingId) {
            const group = this.buildingGroups.get(this.selectedBuildingId);
            if (group) {
                group.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        const sectionId = child.userData.sectionId as string;
                        const prevOriginal = this.originalMaterials.get(sectionId);
                        if (prevOriginal) {
                            if (!Array.isArray(child.material)) {
                                child.material.dispose();
                            }
                            child.material = prevOriginal;
                            this.lightmapManager?.registerMesh(`section_${sectionId}`, child);
                        }
                    }
                });
            }
        }

        this.selectedBuildingId = newBuildingId ?? null;

        // Apply semi-transparent material to new selection
        if (this.selectedBuildingId) {
            const group = this.buildingGroups.get(this.selectedBuildingId);
            if (group) {
                group.traverse((child) => {
                    if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
                        const originalMaterial = child.material as THREE.MeshPhongMaterial;
                        const sectionId = child.userData.sectionId as string;
                        if (!this.originalMaterials.has(sectionId)) {
                            this.originalMaterials.set(sectionId, originalMaterial);
                        }
                        this.lightmapManager?.unregisterMesh(`section_${sectionId}`);
                        const selectedMaterial = new THREE.MeshPhongMaterial({
                            color: originalMaterial.color,
                            transparent: true,
                            opacity: 0.5,
                            depthWrite: false,
                        });
                        child.material = selectedMaterial;
                    }
                });
            }
        }
    }

    public getBuildingMeshes(): THREE.Mesh[] {
        return Array.from(this.sectionMeshes.values());
    }

    public getBuildingMesh(buildingId: string): THREE.Group | undefined {
        return this.buildingGroups.get(buildingId);
    }

    public getSectionMesh(sectionId: string): THREE.Mesh | undefined {
        return this.sectionMeshes.get(sectionId);
    }

    public getBuildingIdFromMesh(mesh: THREE.Object3D): string | null {
        return (mesh.userData.buildingId as string) ?? null;
    }

    public getSectionIdFromMesh(mesh: THREE.Object3D): string | null {
        return (mesh.userData.sectionId as string) ?? null;
    }

    private getSectionsForBuilding(buildingId: string): SectionData[] {
        return getSortedBuildingSections(this.store, buildingId);
    }

    private getNodesForSection(sectionId: string): NodeData[] {
        const nodes: NodeData[] = [];
        this.store.getRowIds("nodes").forEach((rowId) => {
            const row = this.store.getRow("nodes", rowId);
            if (row.sectionId === sectionId) {
                nodes.push({
                    x: row.x as number,
                    z: row.z as number,
                    idx: row.idx as number,
                });
            }
        });
        nodes.sort((a, b) => a.idx - b.idx);
        return nodes;
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

        // Listen for section changes to rebuild affected buildings
        this.sectionListenerId = this.store.addRowListener(
            "sections",
            null,
            (_store, _tableId, rowId) => {
                if (rowId) {
                    const row = this.store.getRow("sections", rowId);
                    if (row && row.bldgId) {
                        this.createBuilding(row.bldgId as string);
                    }
                }
            },
        );

        // Listen for node coordinate changes to rebuild affected sections/buildings
        this.nodeListenerId = this.store.addCellListener(
            "nodes",
            null,
            null,
            (_store, _tableId, rowId, cellId) => {
                if (cellId === "x" || cellId === "z") {
                    const row = this.store.getRow("nodes", rowId);
                    if (row && row.sectionId) {
                        const sectionRow = this.store.getRow("sections", row.sectionId as string);
                        if (sectionRow && sectionRow.bldgId) {
                            this.createBuilding(sectionRow.bldgId as string);
                        }
                    }
                }
            },
        );
    }

    private createBuilding(buildingId: string) {
        // Clean up existing building group
        if (this.buildingGroups.has(buildingId)) {
            const group = this.buildingGroups.get(buildingId);
            if (group) {
                group.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        const sectionId = child.userData.sectionId as string;
                        this.lightmapManager?.unregisterMesh(`section_${sectionId}`);
                        child.geometry.dispose();
                        if (Array.isArray(child.material)) {
                            child.material.forEach((m) => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                        this.sectionMeshes.delete(sectionId);
                        this.originalMaterials.delete(sectionId);
                    }
                });
                this.scene.remove(group);
                this.buildingGroups.delete(buildingId);
            }
        }

        const building = this.store.getRow("buildings", buildingId);
        if (!building) return;

        const sections = this.getSectionsForBuilding(buildingId);
        if (sections.length === 0) return;

        const buildingGroup = new THREE.Group();
        buildingGroup.userData.buildingId = buildingId;

        for (const section of sections) {
            const mesh = this.createSectionMesh(section, buildingId);
            if (mesh) {
                buildingGroup.add(mesh);
                this.sectionMeshes.set(section.sectionId, mesh);
                this.originalMaterials.set(section.sectionId, mesh.material as THREE.Material);

                // If this building is currently selected, apply the semi-transparent material
                if (this.selectedBuildingId === buildingId) {
                    const originalMaterial = mesh.material as THREE.MeshPhongMaterial;
                    this.lightmapManager?.unregisterMesh(`section_${section.sectionId}`);
                    const selectedMaterial = new THREE.MeshPhongMaterial({
                        color: originalMaterial.color,
                        transparent: true,
                        opacity: 0.5,
                    });
                    mesh.material = selectedMaterial;
                } else {
                    this.lightmapManager?.registerMesh(`section_${section.sectionId}`, mesh);
                }
            }
        }

        this.buildingGroups.set(buildingId, buildingGroup);
        this.scene.add(buildingGroup);
    }

    private createSectionMesh(section: SectionData, buildingId: string): THREE.Mesh | null {
        const nodes = this.getNodesForSection(section.sectionId);
        if (nodes.length < 3) return null;

        // Create a THREE.Shape from the node coordinates
        const shape = new THREE.Shape();
        shape.moveTo(nodes[0].x, -nodes[0].z);
        for (let i = 1; i < nodes.length; i++) {
            shape.lineTo(nodes[i].x, -nodes[i].z);
        }
        shape.closePath();

        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: section.height,
            bevelEnabled: false,
        });

        // Normalize UVs to 0-1 range for lightmap compatibility
        const uvAttr = geometry.getAttribute("uv");
        if (uvAttr) {
            let minU = Infinity,
                maxU = -Infinity;
            let minV = Infinity,
                maxV = -Infinity;

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

            for (let i = 0; i < uvAttr.count; i++) {
                const u = uvAttr.getX(i);
                const v = uvAttr.getY(i);
                uvAttr.setXY(i, (u - minU) / rangeU, (v - minV) / rangeV);
            }
            uvAttr.needsUpdate = true;
        }

        const material = new THREE.MeshPhongMaterial({
            color: section.color,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.buildingId = buildingId;
        mesh.userData.sectionId = section.sectionId;

        // ExtrudeGeometry extrudes along Z axis, rotate so extrusion goes up (Y axis)
        mesh.rotation.x = -Math.PI / 2;

        // Position at section's computed base elevation (building base + cumulative heights of prior sections)
        mesh.position.y = section.computedBaseElevation;

        return mesh;
    }

    public dispose() {
        if (this.selectionListenerId && this.localStore) {
            this.localStore.delListener(this.selectionListenerId);
        }
        if (this.nodeListenerId) {
            this.store.delListener(this.nodeListenerId);
        }
        if (this.sectionListenerId) {
            this.store.delListener(this.sectionListenerId);
        }
        this.buildingGroups.forEach((group) => {
            group.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    const sectionId = child.userData.sectionId as string;
                    this.lightmapManager?.unregisterMesh(`section_${sectionId}`);
                    child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            this.scene.remove(group);
        });
        this.buildingGroups.clear();
        this.sectionMeshes.clear();
        this.originalMaterials.clear();
    }
}
