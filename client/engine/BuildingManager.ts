import * as THREE from "three";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { constructPolygonMeshObject } from "../geometry/constructPolygonMeshObject";
import { PolygonCoords } from "../geometry/types";

export class BuildingManager {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private buildingMeshes: Map<string, THREE.Mesh> = new Map();

    constructor(scene: THREE.Scene, store: WorldsyncStore) {
        this.scene = scene;
        this.store = store;
        this.initialize();
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

        // Rotate to align with world coordinates (Y-up)
        mesh.rotation.x = -Math.PI / 2;

        // Fix position to match world coordinates
        const { x, y, z } = mesh.position;
        mesh.position.set(x, z, -y);

        this.buildingMeshes.set(buildingId, mesh);
        this.scene.add(mesh);
    }

    public dispose() {
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
    }
}
