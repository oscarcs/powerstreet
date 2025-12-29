/**
 * Bounding box in 2D (x-z plane).
 */
export interface BoundingBox {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}

/**
 * Result of a spatial query.
 */
export interface SpatialEntry<T> {
    id: string;
    bounds: BoundingBox;
    data: T;
}

/**
 * Interface for spatial indexing structures.
 * Supports efficient spatial queries for rendering and sync.
 */
export interface SpatialIndex<T> {
    /**
     * Insert an item into the spatial index.
     */
    insert(id: string, bounds: BoundingBox, data: T): void;

    /**
     * Remove an item from the spatial index.
     */
    remove(id: string): boolean;

    /**
     * Update an item's bounds in the spatial index.
     */
    update(id: string, bounds: BoundingBox): boolean;

    /**
     * Query all items that intersect with the given bounds.
     */
    query(bounds: BoundingBox): SpatialEntry<T>[];

    /**
     * Query all items that contain the given point.
     */
    queryPoint(x: number, z: number): SpatialEntry<T>[];

    /**
     * Query all items within a radius of a point.
     */
    queryRadius(x: number, z: number, radius: number): SpatialEntry<T>[];

    /**
     * Get all items in the index.
     */
    getAll(): SpatialEntry<T>[];

    /**
     * Get the number of items in the index.
     */
    size(): number;

    /**
     * Clear all items from the index.
     */
    clear(): void;

    /**
     * Check if an item exists in the index.
     */
    has(id: string): boolean;

    /**
     * Get a specific item by ID.
     */
    get(id: string): SpatialEntry<T> | null;
}

/**
 * Helper function to check if two bounding boxes intersect.
 */
export function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

/**
 * Helper function to check if a point is inside a bounding box.
 */
export function pointInBox(x: number, z: number, box: BoundingBox): boolean {
    return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

/**
 * Helper function to check if a bounding box is within a radius of a point.
 */
export function boxIntersectsCircle(box: BoundingBox, cx: number, cz: number, radius: number): boolean {
    // Find closest point on box to circle center
    const closestX = Math.max(box.minX, Math.min(cx, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(cz, box.maxZ));

    // Check if closest point is within radius
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return dx * dx + dz * dz <= radius * radius;
}

/**
 * Helper function to expand a bounding box by a margin.
 */
export function expandBox(box: BoundingBox, margin: number): BoundingBox {
    return {
        minX: box.minX - margin,
        minZ: box.minZ - margin,
        maxX: box.maxX + margin,
        maxZ: box.maxZ + margin,
    };
}

/**
 * Helper function to compute the union of two bounding boxes.
 */
export function unionBoxes(a: BoundingBox, b: BoundingBox): BoundingBox {
    return {
        minX: Math.min(a.minX, b.minX),
        minZ: Math.min(a.minZ, b.minZ),
        maxX: Math.max(a.maxX, b.maxX),
        maxZ: Math.max(a.maxZ, b.maxZ),
    };
}

/**
 * Helper function to compute a bounding box from a set of points.
 */
export function computeBounds(points: [number, number][]): BoundingBox {
    if (points.length === 0) {
        return { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
    }

    let minX = points[0][0];
    let minZ = points[0][1];
    let maxX = points[0][0];
    let maxZ = points[0][1];

    for (let i = 1; i < points.length; i++) {
        const [x, z] = points[i];
        if (x < minX) minX = x;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (z > maxZ) maxZ = z;
    }

    return { minX, minZ, maxX, maxZ };
}
