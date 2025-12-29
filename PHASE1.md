# Phase 1: Data Structure Foundation

This document describes the implementation plan for Phase 1 of the powerstreet project, focusing on establishing the foundational data structures that will support both rendering at scale and multiplayer sync.

---

## Implementation Status

**Status: IMPLEMENTED** (pending review)

### Completed Tasks

| Task | Status | Files |
|------|--------|-------|
| Extend WorldsyncStore schema | ✅ Done | `shared/WorldsyncStore.ts` |
| Implement GridIndex spatial indexing | ✅ Done | `client/spatial/GridIndex.ts`, `client/spatial/SpatialIndex.ts` |
| Implement TileManager | ✅ Done | `client/spatial/TileManager.ts` |
| Integrate spatial index with BuildingManager | ✅ Done | `client/engine/BuildingManager.ts` |
| Integrate spatial index with StreetManager | ✅ Done | `client/engine/StreetManager.ts` |
| Port block detection algorithm | ✅ Done | `shared/procgen/BlockDetection.ts` |
| Port lot subdivision algorithm | ✅ Done | `shared/procgen/LotSubdivision.ts` |
| Implement sync protocol in Durable Object | ✅ Done | `workers/worldsync/src/index.ts` |
| Implement SyncClient for client-side | ✅ Done | `client/data/SyncClient.ts` |

### Implementation Notes

**Schema Changes:**
- Added street node `elevation` field
- Added street edge fields: `roadType`, `speedLimit`, `lanes`, `oneWay`, `curveType`, `curveData`
- Added `districts`, `blocks`, and `lots` tables with full zoning/subdivision rule support
- Added typed helper functions and interfaces for all new tables

**Spatial Indexing:**
- Grid-based index with configurable cell size (default 500m to match tile size)
- TileManager provides tile-based organization with LOD support and dirty tracking
- Both BuildingManager and StreetManager now track entities in the TileManager

**Procgen Algorithms:**
- Block detection uses minimal cycle traversal with rightmost-turn rule
- Lot subdivision uses simplified perpendicular-ray approach (not full straight-skeleton)
- Both algorithms work in local coordinates (no Turf.js dependency yet)

**Sync Protocol:**
- WebSocket-based with subscribe/delta/fullSync message types
- Durable Object stores state with `table:rowId` key format
- Client tracks changes via TinyBase listeners and sends deltas
- Broadcast to other subscribed clients (excluding sender)

### What's NOT Implemented Yet

- Straight skeleton for proper strip generation (using simplified subdivision instead)
- Incremental rendering updates (still rebuilds all geometry on change)
- Actual LOD geometry simplification
- Lock/CRDT conflict resolution for complex edits

---

## Goals

1. Implement graph-first street network data model with extended metadata
2. Design spatial indexing that serves both rendering (tile queries) and sync (delta computation)
3. Port lot subdivision algorithms from the viz project
4. Establish TinyBase to Durable Objects sync patterns

## Current State Analysis

### Street Network (Current)

Location: `shared/WorldsyncStore.ts`

```typescript
// Current schema
streetNodes: { x: number, z: number }
streetEdges: { startNodeId, endNodeId, streetGroupId, width }
streetGroups: { name, color, defaultWidth }
```

The current implementation is already graph-first, which is good. However, it lacks:
- Road type classification (arterial, collector, local, etc.)
- Speed limits
- Elevation support
- Curve metadata for non-straight roads
- One-way/direction information

### Building/Lot System (Current)

Location: `shared/WorldsyncStore.ts`

```typescript
// Current schema
buildings: { type, roofType, roofParam, tileId, baseElevation }
sections: { bldgId, sectionIdx, height, color }
nodes: { sectionId, x, z, idx }
```

Buildings are section-based with polygon nodes. This is flexible but there's no concept of:
- Lots (the land parcel a building sits on)
- Blocks (areas bounded by streets)
- Districts (zoning regions)

### Spatial Indexing (Current)

**None exists.** The `StreetManager` rebuilds all streets on any change. The `BuildingManager` iterates all rows. This won't scale to 10K-50K buildings.

### Sync (Current)

Location: `workers/worldsync/src/index.ts`

The Durable Object infrastructure exists but the sync protocol is not implemented. WebSocket connections are tracked but no message handling exists.

---

## Implementation Tasks

### 1. Extend Street Network Schema

**File:** `shared/WorldsyncStore.ts`

Add new fields to support the full graph-first architecture:

```typescript
streetNodes: {
    x: { type: "number" },
    z: { type: "number" },
    elevation: { type: "number" },  // NEW: Y-coordinate for 3D
},

streetEdges: {
    startNodeId: { type: "string" },
    endNodeId: { type: "string" },
    streetGroupId: { type: "string" },
    width: { type: "number" },
    // NEW fields:
    roadType: { type: "string" },      // "arterial" | "collector" | "local" | "alley"
    speedLimit: { type: "number" },     // km/h
    lanes: { type: "number" },          // lane count
    oneWay: { type: "boolean" },        // direction constraint
    curveType: { type: "string" },      // "straight" | "arc" | "bezier"
    curveData: { type: "string" },      // JSON-encoded curve params if not straight
},

streetGroups: {
    name: { type: "string" },
    color: { type: "string" },
    defaultWidth: { type: "number" },
    defaultRoadType: { type: "string" },  // NEW
    defaultSpeedLimit: { type: "number" }, // NEW
},
```

**Why:** This enables traffic simulation (capacity = lanes * speed), multimodal transport (road type determines allowed vehicles), and elevated structures (elevation on nodes).

### 2. Add Lot, Block, and District Tables

**File:** `shared/WorldsyncStore.ts`

```typescript
// NEW tables
districts: {
    name: { type: "string" },
    color: { type: "string" },
    // Subdivision rules
    minLotFrontage: { type: "number" },
    maxLotFrontage: { type: "number" },
    minLotArea: { type: "number" },
    maxLotDepth: { type: "number" },
    // Zoning rules (for later phases)
    maxHeight: { type: "number" },
    maxFAR: { type: "number" },
    setbackFront: { type: "number" },
    setbackSide: { type: "number" },
    setbackRear: { type: "number" },
},

blocks: {
    districtId: { type: "string" },
    // Polygon boundary stored as JSON array of [x, z] coords
    boundaryCoords: { type: "string" },
    // Computed from street graph - list of edge IDs forming boundary
    boundaryEdgeIds: { type: "string" },
},

lots: {
    blockId: { type: "string" },
    // Polygon boundary stored as JSON array of [x, z] coords
    boundaryCoords: { type: "string" },
    // Street frontage info
    frontageEdgeId: { type: "string" },
    frontageLength: { type: "number" },
    // Current state
    buildingId: { type: "string" },  // null if vacant
    // Economic data (for later phases)
    landValue: { type: "number" },
},
```

**Why:** This creates the hierarchy: District → Block → Lot → Building. Districts define subdivision and zoning rules. Blocks are computed from the street graph. Lots are subdivided within blocks.

### 3. Create Spatial Index Module

**New file:** `client/spatial/SpatialIndex.ts`

Implement a quadtree or grid-based spatial index:

```typescript
export interface SpatialIndex<T> {
    insert(id: string, bounds: BoundingBox, data: T): void;
    remove(id: string): void;
    update(id: string, bounds: BoundingBox): void;
    query(bounds: BoundingBox): Array<{ id: string; data: T }>;
    queryPoint(x: number, z: number): Array<{ id: string; data: T }>;
    queryRadius(x: number, z: number, radius: number): Array<{ id: string; data: T }>;
}

export interface BoundingBox {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}

// Implementation options:
// 1. Simple grid (fixed cell size, O(1) insert/query for small areas)
// 2. Quadtree (adaptive subdivision, better for varied density)
// 3. R-tree (optimal for rectangles, more complex)

// Recommendation: Start with a simple grid (e.g., 100m cells)
// This is easy to implement, debug, and aligns well with tile-based rendering
```

**New file:** `client/spatial/GridIndex.ts`

```typescript
export class GridIndex<T> implements SpatialIndex<T> {
    private cellSize: number;
    private cells: Map<string, Map<string, { bounds: BoundingBox; data: T }>>;

    constructor(cellSize: number = 100) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    private getCellKey(x: number, z: number): string {
        const cellX = Math.floor(x / this.cellSize);
        const cellZ = Math.floor(z / this.cellSize);
        return `${cellX},${cellZ}`;
    }

    private getCellsForBounds(bounds: BoundingBox): string[] {
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

    // ... insert, remove, update, query implementations
}
```

**Why:** Spatial indexing is critical for:
- Rendering: Query visible tiles for camera frustum
- Sync: Compute deltas only for affected spatial regions
- Subdivision: Find edges within a block boundary
- Traffic: Find roads near a location

### 4. Create Tile Manager

**New file:** `client/spatial/TileManager.ts`

The tile manager divides the world into fixed-size tiles for rendering and sync:

```typescript
export interface Tile {
    id: string;           // "x,z" grid coordinates
    bounds: BoundingBox;
    // Cached geometry for rendering
    buildingMeshes: THREE.InstancedMesh[];
    streetMeshes: THREE.Mesh[];
    // LOD level (0 = full detail, higher = simplified)
    lodLevel: number;
    // Dirty flag for rebuild
    dirty: boolean;
}

export class TileManager {
    private tileSize: number;  // e.g., 500 meters
    private tiles: Map<string, Tile>;
    private spatialIndex: SpatialIndex<string>;  // building/street IDs by location

    // Get tiles visible to camera
    getVisibleTiles(frustum: THREE.Frustum): Tile[];

    // Mark tile dirty when content changes
    markDirty(tileId: string): void;

    // Rebuild dirty tiles (call each frame or on idle)
    rebuildDirtyTiles(maxRebuildTime: number): void;

    // LOD: determine detail level based on camera distance
    updateLOD(cameraPosition: THREE.Vector3): void;
}
```

**Why:** Tiles enable:
- Frustum culling (only render visible tiles)
- LOD (distant tiles use simplified geometry)
- Incremental updates (only rebuild changed tiles)
- Sync boundaries (sync deltas can be per-tile)

### 5. Port Lot Subdivision Algorithms

The viz project's `/procgen` directory contains two key algorithms:

#### 5.1 Block Detection from Street Graph

**New file:** `shared/procgen/BlockDetection.ts`

Detect enclosed blocks from the street graph:

```typescript
export function detectBlocksFromStreetGraph(
    nodes: Map<string, { x: number; z: number }>,
    edges: Map<string, { startNodeId: string; endNodeId: string }>
): Block[] {
    // Algorithm:
    // 1. Build adjacency list from edges
    // 2. For each edge, find the minimal cycle to its left
    // 3. Each unique minimal cycle is a block
    // 4. Filter out the "outside" block (largest area, counter-clockwise)

    // This is the "face detection" problem in a planar graph
    // Can use a planar face traversal algorithm
}
```

#### 5.2 Straight Skeleton Strip Generation

**New file:** `shared/procgen/Strips.ts`

Port from `~/Dev/viz/src/procgen/Strips.ts`:

```typescript
// The viz implementation uses:
// - straight-skeleton-geojson library
// - Turf.js for geometric operations
// - Geographic coordinates (lat/lon)

// For powerstreet, we need to:
// 1. Keep using straight-skeleton-geojson (it's complex to reimplement)
// 2. Replace Turf.js operations with local coordinate equivalents
// 3. Remove geographic coordinate conversions

export function generateStripsFromBlock(
    block: Block,
    maxLotDepth: number
): Map<string, Strip> {
    // Step 1: Calculate straight skeleton faces
    // Step 2: Group into alpha-strips by adjacent street
    // Step 3: Merge into beta-strips with corner swapping
}
```

**Dependencies to add:** `straight-skeleton-geojson` (already used in viz)

**Coordinate conversion notes:**
- The viz code uses `lengthToDegrees()` to convert meters to geographic degrees
- For powerstreet, we work in meters directly, so these conversions can be removed
- Buffer operations in viz use azimuthal projection; we can use direct metric buffers

#### 5.3 Lot Subdivision

**New file:** `shared/procgen/Lots.ts`

Port from `~/Dev/viz/src/procgen/Lots.ts`:

```typescript
export interface SubdivisionRules {
    minLotFrontage: number;   // meters
    maxLotFrontage: number;   // meters
    minLotArea: number;       // square meters
    maxLotDepth: number;      // meters
}

export function subdivideLots(
    strip: Strip,
    rules: SubdivisionRules
): Lot[] {
    // 1. Find street-facing edges of strip
    // 2. Generate perpendicular splitting rays at intervals
    // 3. Slice strip with rays to create lots
    // 4. Validate and merge undersized lots
}
```

**Key constants from viz (adjustable per district):**
- `LOT_MIN_AREA = 750` square meters
- Default lot width = 25 meters
- Ray length = maxLotDepth + 30 meters

#### 5.4 Polygon Utilities

**New file:** `shared/procgen/PolygonOps.ts`

Port or adapt needed operations:

```typescript
// From viz, we need:
export function polygonSlice(polygon: Polygon, line: LineString): Polygon[];
export function polygonUnion(polygons: Polygon[]): Polygon;
export function polygonBuffer(polygon: Polygon, distance: number): Polygon;
export function lineOverlap(line1: LineString, line2: LineString): LineString | null;

// Some of these exist in client/geometry/PolygonUtils.ts
// Others may need Turf.js or a local implementation
```

**Dependency decision:** Turf.js is already used in the viz project. We can either:
1. Add Turf.js to powerstreet (adds bundle size but proven algorithms)
2. Implement minimal versions of needed operations (more work, smaller bundle)

**Recommendation:** Add Turf.js for Phase 1 to reduce porting risk. Optimize later if needed.

### 6. Implement Basic Sync Protocol

**File:** `workers/worldsync/src/index.ts`

Implement the sync message protocol:

```typescript
// Message types
type SyncMessage =
    | { type: "subscribe"; tables: string[] }
    | { type: "unsubscribe"; tables: string[] }
    | { type: "delta"; table: string; changes: RowChange[] }
    | { type: "fullSync"; table: string; rows: Row[] }
    | { type: "ack"; messageId: string };

interface RowChange {
    rowId: string;
    operation: "insert" | "update" | "delete";
    data?: Record<string, unknown>;
}

// In WorldSyncDurableObject:
export class WorldSyncDurableObject {
    private sessions: Map<string, WebSocket>;
    private state: DurableObjectState;

    async handleMessage(ws: WebSocket, message: SyncMessage) {
        switch (message.type) {
            case "subscribe":
                // Track which tables this client cares about
                break;
            case "delta":
                // Apply change to DO storage
                // Broadcast to other subscribed clients
                break;
            // ...
        }
    }
}
```

**File:** `client/data/SyncClient.ts`

Client-side sync handler:

```typescript
export class SyncClient {
    private ws: WebSocket;
    private store: Store;
    private pendingChanges: Map<string, RowChange>;

    constructor(store: Store, serverUrl: string) {
        this.store = store;
        this.connect(serverUrl);
        this.setupStoreListeners();
    }

    private setupStoreListeners() {
        // Listen to TinyBase changes and queue for sync
        this.store.addRowListener(null, null, (store, tableId, rowId) => {
            this.queueChange(tableId, rowId);
        });
    }

    private queueChange(tableId: string, rowId: string) {
        // Debounce and batch changes
        // Send deltas to server
    }

    private handleServerMessage(message: SyncMessage) {
        if (message.type === "delta") {
            // Apply remote changes to local store
            // Avoid re-triggering sync for changes we receive
        }
    }
}
```

### 7. Integrate Spatial Index with Managers

**File:** `client/engine/BuildingManager.ts`

Add spatial index integration:

```typescript
export class BuildingManager {
    private spatialIndex: SpatialIndex<string>;

    constructor(/* ... */, spatialIndex: SpatialIndex<string>) {
        this.spatialIndex = spatialIndex;
        // ...
    }

    private createBuilding(buildingId: string) {
        // ... existing mesh creation ...

        // Add to spatial index
        const bounds = this.calculateBuildingBounds(buildingId);
        this.spatialIndex.insert(buildingId, bounds, buildingId);
    }

    private removeBuilding(buildingId: string) {
        // ... existing mesh removal ...
        this.spatialIndex.remove(buildingId);
    }
}
```

**File:** `client/engine/StreetManager.ts`

Modify to use incremental updates:

```typescript
export class StreetManager {
    private spatialIndex: SpatialIndex<string>;
    private dirtyEdges: Set<string>;

    // Instead of rebuilding all streets:
    private handleEdgeChange(edgeId: string) {
        this.dirtyEdges.add(edgeId);
        // Schedule incremental rebuild
    }

    rebuildDirtyStreets() {
        for (const edgeId of this.dirtyEdges) {
            this.rebuildStreetSegment(edgeId);
        }
        this.dirtyEdges.clear();
    }
}
```

---

## File Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `client/spatial/SpatialIndex.ts` | Spatial index interface |
| `client/spatial/GridIndex.ts` | Grid-based spatial index implementation |
| `client/spatial/TileManager.ts` | Tile management for rendering/sync |
| `shared/procgen/BlockDetection.ts` | Detect blocks from street graph |
| `shared/procgen/Strips.ts` | Straight skeleton strip generation |
| `shared/procgen/Lots.ts` | Lot subdivision algorithm |
| `shared/procgen/PolygonOps.ts` | Polygon operations (slice, union, buffer) |
| `client/data/SyncClient.ts` | Client-side sync handler |

### Files to Modify

| File | Changes |
|------|---------|
| `shared/WorldsyncStore.ts` | Add streetNode elevation, streetEdge metadata, districts, blocks, lots tables |
| `client/engine/BuildingManager.ts` | Integrate spatial index |
| `client/engine/StreetManager.ts` | Integrate spatial index, incremental updates |
| `client/engine/Engine.ts` | Initialize spatial index and tile manager |
| `workers/worldsync/src/index.ts` | Implement sync message handling |
| `package.json` | Add dependencies (turf, straight-skeleton-geojson) |

### Dependencies to Add

```json
{
    "@turf/turf": "^7.0.0",
    "straight-skeleton-geojson": "^1.0.0"
}
```

---

## Implementation Order

1. **Week 1: Schema and Spatial Index**
   - Extend WorldsyncStore schema
   - Implement GridIndex
   - Add spatial index to BuildingManager and StreetManager

2. **Week 2: Tile System**
   - Implement TileManager
   - Integrate with rendering pipeline
   - Add frustum culling

3. **Week 3: Block Detection and Strips**
   - Port block detection from street graph
   - Port straight skeleton strip generation
   - Add test cases

4. **Week 4: Lot Subdivision**
   - Port lot subdivision algorithm
   - Connect to district rules
   - UI for district editing

5. **Week 5: Sync Protocol**
   - Implement server message handling
   - Implement client sync
   - Test with multiple clients

---

## Testing Strategy

### Unit Tests

- Spatial index: insert, query, update, remove
- Block detection: simple grid, irregular street network
- Lot subdivision: various strip shapes, edge cases

### Integration Tests

- End-to-end: draw streets → detect blocks → subdivide lots → place buildings
- Sync: two clients, concurrent edits, conflict resolution

### Performance Tests

- Spatial index with 50K entries
- Tile rendering with 10K buildings
- Sync latency with rapid edits

---

## Open Questions for Implementation

1. **Straight skeleton library:** The `straight-skeleton-geojson` library works with GeoJSON coordinates. Do we need to convert to/from local coordinates, or should we maintain a parallel GeoJSON representation for the procgen algorithms?

2. **Tile size:** What's the optimal tile size? Smaller tiles = more granular updates but more overhead. Larger tiles = simpler but coarser updates. Suggested starting point: 500m tiles.

3. **Sync granularity:** Should we sync entire tables, per-tile deltas, or individual row changes? Per-tile deltas align well with rendering but add complexity.

4. **Block detection trigger:** When should blocks be recalculated? On every street edit, or on explicit "finalize" action? Automatic is more seamless but potentially expensive.

---

## Success Criteria

Phase 1 is complete when:

1. Street network supports all new metadata fields
2. Spatial index enables sub-linear query times
3. Tile-based rendering shows measurable performance improvement
4. Lot subdivision produces valid lots from a street grid
5. Two clients can sync edits through the Durable Object
6. Performance: 10K buildings render at 60fps, sync latency < 100ms
