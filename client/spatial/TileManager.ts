import * as THREE from "three";
import { BoundingBox } from "./SpatialIndex";
import { GridIndex } from "./GridIndex";

/**
 * Entity types that can be tracked by the tile manager.
 */
export type EntityType = "building" | "street" | "lot" | "block";

/**
 * Represents an entity in the world with its spatial data.
 */
export interface TileEntity {
    id: string;
    type: EntityType;
    bounds: BoundingBox;
}

/**
 * Represents a tile in the world grid.
 */
export interface Tile {
    id: string; // "x,z" grid coordinates
    bounds: BoundingBox;
    dirty: boolean; // Needs rebuild
    lodLevel: number; // 0 = full detail, higher = simplified
    entityCount: number;
    lastUpdateTime: number;
}

/**
 * Configuration for the tile manager.
 */
export interface TileManagerConfig {
    tileSize: number; // Size of each tile in world units (default 500)
    debounceMs: number; // Debounce time for dirty marking (default 500)
    maxLodLevel: number; // Maximum LOD level (default 3)
    lodDistances: number[]; // Camera distances for each LOD level
}

const DEFAULT_CONFIG: TileManagerConfig = {
    tileSize: 500,
    debounceMs: 500,
    maxLodLevel: 3,
    lodDistances: [500, 1500, 4000], // LOD 1 at 500m, LOD 2 at 1500m, LOD 3 at 4000m
};

/**
 * Manages tiles for spatial organization of the world.
 *
 * Tiles provide:
 * - Frustum culling for rendering (only process visible tiles)
 * - LOD management based on camera distance
 * - Change tracking for incremental updates
 * - Spatial organization for sync deltas
 */
export class TileManager {
    private config: TileManagerConfig;
    private tiles: Map<string, Tile>;
    private spatialIndex: GridIndex<TileEntity>;
    private dirtyTiles: Set<string>;
    private debounceTimers: Map<string, number>;
    private listeners: Set<(tileIds: string[]) => void>;
    private tileCreatedListeners: Set<(tileKey: string) => void>;

    constructor(config: Partial<TileManagerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.tiles = new Map();
        this.spatialIndex = new GridIndex(this.config.tileSize);
        this.dirtyTiles = new Set();
        this.debounceTimers = new Map();
        this.listeners = new Set();
        this.tileCreatedListeners = new Set();
    }

    /**
     * Add an entity to the tile system.
     */
    addEntity(id: string, type: EntityType, bounds: BoundingBox): void {
        const entity: TileEntity = { id, type, bounds };
        this.spatialIndex.insert(id, bounds, entity);

        // Mark affected tiles as dirty
        const affectedTiles = this.getTileKeysForBounds(bounds);
        for (const tileKey of affectedTiles) {
            this.markTileDirty(tileKey);
            this.ensureTileExists(tileKey);
        }
    }

    /**
     * Remove an entity from the tile system.
     */
    removeEntity(id: string): void {
        const entry = this.spatialIndex.get(id);
        if (!entry) return;

        // Mark affected tiles as dirty before removal
        const affectedTiles = this.getTileKeysForBounds(entry.bounds);
        for (const tileKey of affectedTiles) {
            this.markTileDirty(tileKey);
        }

        this.spatialIndex.remove(id);
    }

    /**
     * Update an entity's bounds.
     */
    updateEntity(id: string, bounds: BoundingBox): void {
        const entry = this.spatialIndex.get(id);
        if (!entry) {
            // Entity doesn't exist, add it
            this.addEntity(id, "building", bounds);
            return;
        }

        // Mark old tiles as dirty
        const oldTiles = this.getTileKeysForBounds(entry.bounds);
        for (const tileKey of oldTiles) {
            this.markTileDirty(tileKey);
        }

        // Update bounds
        this.spatialIndex.update(id, bounds);

        // Mark new tiles as dirty
        const newTiles = this.getTileKeysForBounds(bounds);
        for (const tileKey of newTiles) {
            this.markTileDirty(tileKey);
            this.ensureTileExists(tileKey);
        }
    }

    /**
     * Get tile keys for a bounding box.
     */
    private getTileKeysForBounds(bounds: BoundingBox): string[] {
        const tileSize = this.config.tileSize;
        const keys: string[] = [];

        const minTileX = Math.floor(bounds.minX / tileSize);
        const maxTileX = Math.floor(bounds.maxX / tileSize);
        const minTileZ = Math.floor(bounds.minZ / tileSize);
        const maxTileZ = Math.floor(bounds.maxZ / tileSize);

        for (let tx = minTileX; tx <= maxTileX; tx++) {
            for (let tz = minTileZ; tz <= maxTileZ; tz++) {
                keys.push(`${tx},${tz}`);
            }
        }

        return keys;
    }

    /**
     * Ensure a tile exists.
     */
    private ensureTileExists(tileKey: string): Tile {
        let tile = this.tiles.get(tileKey);
        if (!tile) {
            const bounds = this.getTileBounds(tileKey);
            if (!bounds) {
                throw new Error(`Invalid tile key: ${tileKey}`);
            }
            tile = {
                id: tileKey,
                bounds,
                dirty: true,
                lodLevel: 0,
                entityCount: 0,
                lastUpdateTime: Date.now(),
            };
            this.tiles.set(tileKey, tile);

            // Notify listeners about new tile
            for (const listener of this.tileCreatedListeners) {
                listener(tileKey);
            }
        }
        return tile;
    }

    /**
     * Get bounds for a tile key.
     */
    getTileBounds(tileKey: string): BoundingBox | null {
        const parts = tileKey.split(",");
        if (parts.length !== 2) return null;

        const tileX = parseInt(parts[0], 10);
        const tileZ = parseInt(parts[1], 10);
        if (isNaN(tileX) || isNaN(tileZ)) return null;

        const tileSize = this.config.tileSize;
        return {
            minX: tileX * tileSize,
            minZ: tileZ * tileSize,
            maxX: (tileX + 1) * tileSize,
            maxZ: (tileZ + 1) * tileSize,
        };
    }

    /**
     * Mark a tile as needing rebuild (debounced).
     */
    private markTileDirty(tileKey: string): void {
        // Clear existing debounce timer
        const existingTimer = this.debounceTimers.get(tileKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new debounce timer
        const timer = window.setTimeout(() => {
            this.dirtyTiles.add(tileKey);
            const tile = this.tiles.get(tileKey);
            if (tile) {
                tile.dirty = true;
            }
            this.debounceTimers.delete(tileKey);
            this.notifyListeners([tileKey]);
        }, this.config.debounceMs);

        this.debounceTimers.set(tileKey, timer);
    }

    /**
     * Mark a tile as dirty immediately (no debounce).
     */
    markTileDirtyImmediate(tileKey: string): void {
        this.dirtyTiles.add(tileKey);
        const tile = this.tiles.get(tileKey);
        if (tile) {
            tile.dirty = true;
        }
        this.notifyListeners([tileKey]);
    }

    /**
     * Get all dirty tiles and clear the dirty set.
     */
    consumeDirtyTiles(): string[] {
        const dirty = Array.from(this.dirtyTiles);
        this.dirtyTiles.clear();

        // Mark tiles as clean
        for (const tileKey of dirty) {
            const tile = this.tiles.get(tileKey);
            if (tile) {
                tile.dirty = false;
                tile.lastUpdateTime = Date.now();
            }
        }

        return dirty;
    }

    /**
     * Get dirty tiles without clearing.
     */
    getDirtyTiles(): string[] {
        return Array.from(this.dirtyTiles);
    }

    /**
     * Check if any tiles are dirty.
     */
    hasDirtyTiles(): boolean {
        return this.dirtyTiles.size > 0;
    }

    /**
     * Get tiles visible to a camera frustum.
     */
    getVisibleTiles(frustum: THREE.Frustum): Tile[] {
        const visible: Tile[] = [];

        for (const tile of this.tiles.values()) {
            // Convert tile bounds to THREE.Box3 for frustum check
            const box = new THREE.Box3(
                new THREE.Vector3(tile.bounds.minX, -1000, tile.bounds.minZ),
                new THREE.Vector3(tile.bounds.maxX, 1000, tile.bounds.maxZ)
            );

            if (frustum.intersectsBox(box)) {
                visible.push(tile);
            }
        }

        return visible;
    }

    /**
     * Get tiles within a bounding box.
     */
    getTilesInBounds(bounds: BoundingBox): Tile[] {
        const tileKeys = this.getTileKeysForBounds(bounds);
        const tiles: Tile[] = [];

        for (const key of tileKeys) {
            const tile = this.tiles.get(key);
            if (tile) {
                tiles.push(tile);
            }
        }

        return tiles;
    }

    /**
     * Update LOD levels based on camera position.
     */
    updateLOD(cameraPosition: THREE.Vector3): void {
        for (const tile of this.tiles.values()) {
            // Calculate distance from camera to tile center
            const centerX = (tile.bounds.minX + tile.bounds.maxX) / 2;
            const centerZ = (tile.bounds.minZ + tile.bounds.maxZ) / 2;
            const dx = cameraPosition.x - centerX;
            const dz = cameraPosition.z - centerZ;
            const distance = Math.sqrt(dx * dx + dz * dz);

            // Determine LOD level based on distance
            let newLodLevel = 0;
            for (let i = 0; i < this.config.lodDistances.length; i++) {
                if (distance > this.config.lodDistances[i]) {
                    newLodLevel = i + 1;
                }
            }
            newLodLevel = Math.min(newLodLevel, this.config.maxLodLevel);

            // If LOD changed, mark tile as needing update
            if (tile.lodLevel !== newLodLevel) {
                tile.lodLevel = newLodLevel;
                this.dirtyTiles.add(tile.id);
                tile.dirty = true;
            }
        }
    }

    /**
     * Get all entities in a tile.
     */
    getEntitiesInTile(tileKey: string): TileEntity[] {
        const bounds = this.getTileBounds(tileKey);
        if (!bounds) return [];

        return this.spatialIndex.query(bounds).map((entry) => entry.data);
    }

    /**
     * Get entities of a specific type in a tile.
     */
    getEntitiesOfTypeInTile(tileKey: string, type: EntityType): TileEntity[] {
        return this.getEntitiesInTile(tileKey).filter((e) => e.type === type);
    }

    /**
     * Query entities in a bounding box.
     */
    queryEntities(bounds: BoundingBox): TileEntity[] {
        return this.spatialIndex.query(bounds).map((entry) => entry.data);
    }

    /**
     * Query entities of a specific type.
     */
    queryEntitiesOfType(bounds: BoundingBox, type: EntityType): TileEntity[] {
        return this.queryEntities(bounds).filter((e) => e.type === type);
    }

    /**
     * Add a listener for dirty tile notifications.
     */
    addDirtyListener(listener: (tileIds: string[]) => void): void {
        this.listeners.add(listener);
    }

    /**
     * Remove a dirty tile listener.
     */
    removeDirtyListener(listener: (tileIds: string[]) => void): void {
        this.listeners.delete(listener);
    }

    /**
     * Add a listener for tile creation notifications.
     */
    addTileCreatedListener(listener: (tileKey: string) => void): void {
        this.tileCreatedListeners.add(listener);
    }

    /**
     * Remove a tile created listener.
     */
    removeTileCreatedListener(listener: (tileKey: string) => void): void {
        this.tileCreatedListeners.delete(listener);
    }

    private notifyListeners(tileIds: string[]): void {
        for (const listener of this.listeners) {
            listener(tileIds);
        }
    }

    /**
     * Get all tiles.
     */
    getAllTiles(): Tile[] {
        return Array.from(this.tiles.values());
    }

    /**
     * Get a specific tile.
     */
    getTile(tileKey: string): Tile | null {
        return this.tiles.get(tileKey) || null;
    }

    /**
     * Get statistics about the tile manager.
     */
    getStats(): {
        tileCount: number;
        dirtyTileCount: number;
        entityCount: number;
        avgEntitiesPerTile: number;
    } {
        const tileCount = this.tiles.size;
        const dirtyTileCount = this.dirtyTiles.size;
        const entityCount = this.spatialIndex.size();
        const avgEntitiesPerTile = tileCount > 0 ? entityCount / tileCount : 0;

        return { tileCount, dirtyTileCount, entityCount, avgEntitiesPerTile };
    }

    /**
     * Clear all tiles and entities.
     */
    clear(): void {
        // Clear debounce timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }

        this.tiles.clear();
        this.spatialIndex.clear();
        this.dirtyTiles.clear();
        this.debounceTimers.clear();
    }

    /**
     * Get the tile size.
     */
    getTileSize(): number {
        return this.config.tileSize;
    }
}
