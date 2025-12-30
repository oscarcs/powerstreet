/**
 * TerrainManager - Manages terrain mesh per tile.
 *
 * Creates and manages ground plane meshes for each active tile,
 * providing seamless terrain coverage as the camera moves.
 */

import * as THREE from "three";
import { TileManager } from "../spatial/TileManager";

export class TerrainManager {
    private scene: THREE.Scene;
    private tileManager: TileManager | null = null;
    private terrainMeshes: Map<string, THREE.Mesh> = new Map();
    private terrainMaterial: THREE.MeshPhysicalMaterial;
    private terrainGroup: THREE.Group;

    constructor(scene: THREE.Scene) {
        this.scene = scene;

        // Create shared material for all terrain tiles
        this.terrainMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xcccccc,
            roughness: 0.9,
            metalness: 0.0,
            depthWrite: true,
        });

        // Group to hold all terrain meshes
        this.terrainGroup = new THREE.Group();
        this.terrainGroup.name = "Terrain";
        this.scene.add(this.terrainGroup);
    }

    /**
     * Connect to the tile manager for tile events.
     */
    setTileManager(tileManager: TileManager): void {
        this.tileManager = tileManager;

        // Listen for tile creation events
        tileManager.addTileCreatedListener((tileKey: string) => {
            this.ensureTileTerrainExists(tileKey);
        });

        // Create terrain for any existing tiles
        for (const tile of tileManager.getAllTiles()) {
            this.ensureTileTerrainExists(tile.id);
        }
    }

    /**
     * Ensure terrain exists for a tile.
     */
    ensureTileTerrainExists(tileKey: string): void {
        if (this.terrainMeshes.has(tileKey)) {
            return;
        }

        if (!this.tileManager) {
            return;
        }

        const bounds = this.tileManager.getTileBounds(tileKey);
        if (!bounds) {
            return;
        }

        const width = bounds.maxX - bounds.minX;
        const depth = bounds.maxZ - bounds.minZ;
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerZ = (bounds.minZ + bounds.maxZ) / 2;

        // Create terrain geometry for this tile
        const geometry = new THREE.PlaneGeometry(width, depth, 16, 16);
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);

        // Position and rotate the terrain
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(centerX, 0, centerZ);
        mesh.receiveShadow = true;
        mesh.name = `Terrain-${tileKey}`;

        this.terrainMeshes.set(tileKey, mesh);
        this.terrainGroup.add(mesh);
    }

    /**
     * Remove terrain for a tile.
     */
    removeTileTerrain(tileKey: string): void {
        const mesh = this.terrainMeshes.get(tileKey);
        if (mesh) {
            this.terrainGroup.remove(mesh);
            mesh.geometry.dispose();
            this.terrainMeshes.delete(tileKey);
        }
    }

    /**
     * Get terrain mesh for a tile.
     */
    getTerrainMesh(tileKey: string): THREE.Mesh | undefined {
        return this.terrainMeshes.get(tileKey);
    }

    /**
     * Ensure terrain exists around a world position.
     * Creates tiles in a radius around the position.
     */
    ensureTerrainAroundPosition(position: THREE.Vector3, radius: number = 500): void {
        if (!this.tileManager) return;

        const tileSize = this.tileManager.getTileSize();
        const tilesInRadius = Math.ceil(radius / tileSize) + 1;

        const centerTileX = Math.floor(position.x / tileSize);
        const centerTileZ = Math.floor(position.z / tileSize);

        for (let dx = -tilesInRadius; dx <= tilesInRadius; dx++) {
            for (let dz = -tilesInRadius; dz <= tilesInRadius; dz++) {
                const tileKey = `${centerTileX + dx},${centerTileZ + dz}`;
                this.ensureTileTerrainExists(tileKey);
            }
        }
    }

    /**
     * Get statistics about terrain.
     */
    getStats(): { terrainTileCount: number } {
        return {
            terrainTileCount: this.terrainMeshes.size,
        };
    }

    /**
     * Dispose of all terrain resources.
     */
    dispose(): void {
        for (const mesh of this.terrainMeshes.values()) {
            mesh.geometry.dispose();
        }
        this.terrainMeshes.clear();
        this.terrainMaterial.dispose();
        this.scene.remove(this.terrainGroup);
    }
}
