import {
    SpatialIndex,
    SpatialEntry,
    BoundingBox,
    boxesIntersect,
    pointInBox,
    boxIntersectsCircle,
} from "./SpatialIndex";

/**
 * Grid-based spatial index implementation.
 *
 * Divides space into fixed-size cells for O(1) insertion and efficient
 * spatial queries. Items that span multiple cells are stored in all
 * overlapping cells.
 *
 * Good for:
 * - Uniform or moderately varied spatial distributions
 * - Frequent insertions and deletions
 * - Tile-based rendering (cells align with render tiles)
 *
 * Trade-offs:
 * - Large items spanning many cells have storage overhead
 * - Cell size should match typical query/item sizes
 */
export class GridIndex<T> implements SpatialIndex<T> {
    private cellSize: number;
    private cells: Map<string, Map<string, SpatialEntry<T>>>;
    private items: Map<string, { entry: SpatialEntry<T>; cellKeys: string[] }>;

    /**
     * Create a new grid index.
     * @param cellSize Size of each cell in world units (default 500m for 500m tiles)
     */
    constructor(cellSize: number = 500) {
        this.cellSize = cellSize;
        this.cells = new Map();
        this.items = new Map();
    }

    /**
     * Get the cell key for a world coordinate.
     */
    private getCellKey(x: number, z: number): string {
        const cellX = Math.floor(x / this.cellSize);
        const cellZ = Math.floor(z / this.cellSize);
        return `${cellX},${cellZ}`;
    }

    /**
     * Get all cell keys that overlap with a bounding box.
     */
    private getCellKeysForBounds(bounds: BoundingBox): string[] {
        const keys: string[] = [];
        const minCellX = Math.floor(bounds.minX / this.cellSize);
        const maxCellX = Math.floor(bounds.maxX / this.cellSize);
        const minCellZ = Math.floor(bounds.minZ / this.cellSize);
        const maxCellZ = Math.floor(bounds.maxZ / this.cellSize);

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cz = minCellZ; cz <= maxCellZ; cz++) {
                keys.push(`${cx},${cz}`);
            }
        }
        return keys;
    }

    /**
     * Get or create a cell.
     */
    private getOrCreateCell(key: string): Map<string, SpatialEntry<T>> {
        let cell = this.cells.get(key);
        if (!cell) {
            cell = new Map();
            this.cells.set(key, cell);
        }
        return cell;
    }

    insert(id: string, bounds: BoundingBox, data: T): void {
        // Remove existing entry if present
        if (this.items.has(id)) {
            this.remove(id);
        }

        const entry: SpatialEntry<T> = { id, bounds, data };
        const cellKeys = this.getCellKeysForBounds(bounds);

        // Add to all overlapping cells
        for (const key of cellKeys) {
            const cell = this.getOrCreateCell(key);
            cell.set(id, entry);
        }

        // Track the item and its cells
        this.items.set(id, { entry, cellKeys });
    }

    remove(id: string): boolean {
        const item = this.items.get(id);
        if (!item) return false;

        // Remove from all cells
        for (const key of item.cellKeys) {
            const cell = this.cells.get(key);
            if (cell) {
                cell.delete(id);
                // Clean up empty cells
                if (cell.size === 0) {
                    this.cells.delete(key);
                }
            }
        }

        this.items.delete(id);
        return true;
    }

    update(id: string, bounds: BoundingBox): boolean {
        const item = this.items.get(id);
        if (!item) return false;

        // Check if cell keys changed
        const newCellKeys = this.getCellKeysForBounds(bounds);
        const oldCellKeys = item.cellKeys;

        // Optimization: if cells unchanged, just update bounds
        if (this.cellKeysEqual(oldCellKeys, newCellKeys)) {
            item.entry.bounds = bounds;
            return true;
        }

        // Otherwise, re-insert
        this.insert(id, bounds, item.entry.data);
        return true;
    }

    private cellKeysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        const setA = new Set(a);
        return b.every((key) => setA.has(key));
    }

    query(bounds: BoundingBox): SpatialEntry<T>[] {
        const results: SpatialEntry<T>[] = [];
        const seen = new Set<string>();
        const cellKeys = this.getCellKeysForBounds(bounds);

        for (const key of cellKeys) {
            const cell = this.cells.get(key);
            if (!cell) continue;

            for (const [id, entry] of cell) {
                if (seen.has(id)) continue;
                seen.add(id);

                // Double-check intersection (item bounds may not fully overlap query)
                if (boxesIntersect(entry.bounds, bounds)) {
                    results.push(entry);
                }
            }
        }

        return results;
    }

    queryPoint(x: number, z: number): SpatialEntry<T>[] {
        const results: SpatialEntry<T>[] = [];
        const key = this.getCellKey(x, z);
        const cell = this.cells.get(key);

        if (!cell) return results;

        for (const [, entry] of cell) {
            if (pointInBox(x, z, entry.bounds)) {
                results.push(entry);
            }
        }

        return results;
    }

    queryRadius(x: number, z: number, radius: number): SpatialEntry<T>[] {
        // Query the bounding box of the circle, then filter by radius
        const bounds: BoundingBox = {
            minX: x - radius,
            minZ: z - radius,
            maxX: x + radius,
            maxZ: z + radius,
        };

        const results: SpatialEntry<T>[] = [];
        const seen = new Set<string>();
        const cellKeys = this.getCellKeysForBounds(bounds);

        for (const key of cellKeys) {
            const cell = this.cells.get(key);
            if (!cell) continue;

            for (const [id, entry] of cell) {
                if (seen.has(id)) continue;
                seen.add(id);

                if (boxIntersectsCircle(entry.bounds, x, z, radius)) {
                    results.push(entry);
                }
            }
        }

        return results;
    }

    getAll(): SpatialEntry<T>[] {
        return Array.from(this.items.values()).map((item) => item.entry);
    }

    size(): number {
        return this.items.size;
    }

    clear(): void {
        this.cells.clear();
        this.items.clear();
    }

    has(id: string): boolean {
        return this.items.has(id);
    }

    get(id: string): SpatialEntry<T> | null {
        const item = this.items.get(id);
        return item ? item.entry : null;
    }

    /**
     * Get statistics about the index for debugging.
     */
    getStats(): { itemCount: number; cellCount: number; avgItemsPerCell: number } {
        const itemCount = this.items.size;
        const cellCount = this.cells.size;
        let totalItems = 0;
        for (const cell of this.cells.values()) {
            totalItems += cell.size;
        }
        const avgItemsPerCell = cellCount > 0 ? totalItems / cellCount : 0;
        return { itemCount, cellCount, avgItemsPerCell };
    }

    /**
     * Get all cell keys that contain items.
     * Useful for tile-based rendering.
     */
    getOccupiedCellKeys(): string[] {
        return Array.from(this.cells.keys());
    }

    /**
     * Get the bounds of a cell by its key.
     */
    getCellBounds(cellKey: string): BoundingBox | null {
        const parts = cellKey.split(",");
        if (parts.length !== 2) return null;

        const cellX = parseInt(parts[0], 10);
        const cellZ = parseInt(parts[1], 10);
        if (isNaN(cellX) || isNaN(cellZ)) return null;

        return {
            minX: cellX * this.cellSize,
            minZ: cellZ * this.cellSize,
            maxX: (cellX + 1) * this.cellSize,
            maxZ: (cellZ + 1) * this.cellSize,
        };
    }

    /**
     * Get all items in a specific cell.
     */
    getItemsInCell(cellKey: string): SpatialEntry<T>[] {
        const cell = this.cells.get(cellKey);
        if (!cell) return [];
        return Array.from(cell.values());
    }

    /**
     * Get the cell size.
     */
    getCellSize(): number {
        return this.cellSize;
    }
}
