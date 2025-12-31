# Phase 1: Data Structure Foundation

This document describes Phase 1 of the powerstreet project, focusing on foundational data structures for rendering at scale and multiplayer sync.

---

## Implementation Status

### Completed

| Task | Files |
|------|-------|
| Extend WorldsyncStore schema | `shared/WorldsyncStore.ts` |
| Implement GridIndex spatial indexing | `client/spatial/GridIndex.ts`, `SpatialIndex.ts` |
| Implement TileManager | `client/spatial/TileManager.ts` |
| Integrate spatial index with managers | `client/engine/BuildingManager.ts`, `StreetManager.ts` |
| Port block detection algorithm | `shared/procgen/BlockDetection.ts` |
| Port lot subdivision algorithm | `shared/procgen/LotSubdivision.ts` |
| Implement sync protocol | `workers/worldsync/src/index.ts`, `client/data/SyncClient.ts` |
| Debug visualization | `client/engine/DebugRenderer.ts`, `client/ui/DebugPanel.tsx` |
| Graph integrity: Node snapping (5m) | `client/engine/TransportGraphUtils.ts`, `Engine.ts` |
| Graph integrity: Edge snapping with auto-split | `client/engine/TransportGraphUtils.ts`, `Engine.ts` |
| Graph integrity: Crossing detection | `client/engine/TransportGraphUtils.ts`, `Engine.ts` |
| Graph integrity: Visual snap feedback | `client/engine/StreetManager.ts` |
| Auto-rebuild blocks on street changes | `client/engine/BlockManager.ts` |
| Multi-way intersection geometry | `client/geometry/IntersectionGeometry.ts`, `client/engine/StreetManager.ts` |
| Block boundary offset for street widths | `shared/procgen/BlockDetection.ts` |
| Straight skeleton for strip generation | `shared/procgen/StripGeneration.ts`, `straight-skeleton-geojson` |
| Strip → lot subdivision | `shared/procgen/LotSubdivision.ts`, `shared/procgen/PolygonUtils.ts` |
| BlockManager for orchestration | `client/engine/BlockManager.ts` |

### Remaining Work

| Task | Notes |
|------|-------|
| Incremental rendering updates | Still rebuilds all geometry on change |
| LOD geometry simplification | TileManager has LOD fields but geometry not simplified |
| Lock/CRDT conflict resolution | For complex multiplayer edits |

---

## Graph Integrity

The street network maintains proper graph topology through automatic snapping and intersection prevention.

### Features Implemented

**Node Snapping (5m threshold)**
- When placing a new street node near an existing node, snaps to that node
- Visual feedback: green ring around snap target

**Edge Snapping with Auto-Split**
- When placing a new node near an existing edge, splits that edge
- Creates a new intersection node at the snap point
- Visual feedback: yellow dot + highlighted edge

**Crossing Prevention**
- New edges that would cross existing edges show red preview
- Creation is blocked until user moves to a valid position

**Automatic Block Recalculation**
- DebugRenderer listens for street graph changes
- Rebuilds block/lot visualization with 300ms debounce

### Files

- `client/engine/TransportGraphUtils.ts` - Graph operations (snap, split, intersect)
- `client/engine/StreetManager.ts` - Preview rendering with snap indicators
- `client/engine/Engine.ts` - Integration with drawing tools

---

## Block Boundary Offset (Completed)

Block detection finds enclosed faces from centerline nodes, but lot subdivision needs the actual buildable land area. The `offsetBlockBoundary()` function in `BlockDetection.ts` computes the inset polygon:

1. For each edge in the block, offsets inward by `width/2` using perpendicular normals
2. At corners, computes miter points where offset edges intersect
3. Clamps miter points to prevent excessive extension at acute angles (max 3x offset)
4. Returns `null` for degenerate cases (inverted polygon, area < 1)

**Debug visualization**: Cyan lines show offset block boundaries; lot subdivision uses these when available.

**Files**: `shared/procgen/BlockDetection.ts`, `client/engine/DebugRenderer.ts`

---

## Block Detection Algorithm

Uses minimal cycle traversal with rightmost-turn rule:
1. Build adjacency list with edges sorted by angle at each node
2. For each unvisited half-edge, trace a cycle by always taking the next CCW edge
3. Filter out the exterior (largest area) face

File: `shared/procgen/BlockDetection.ts`

---

## Strip & Lot Subdivision Algorithm

Uses straight skeleton for strip generation, followed by perpendicular ray subdivision for lots. Based on Vanegas et al. (2012).

### Strip Generation (StripGeneration.ts)

**Step 1 - Alpha Strips**:
1. Compute straight skeleton of the offset block polygon using `straight-skeleton-geojson`
2. Each skeleton face corresponds to one input edge (street frontage)
3. Associate faces with their bounding street edge → "alpha strips"

**Step 2 - Beta Strips** (corner region transfer):
1. Find adjacent pairs of strips (strips that share a skeleton edge)
2. At corners where two streets meet:
   - The shorter street's corner region is transferred to the longer street's strip
   - This produces cleaner lot geometry at intersections
3. Slice the shorter strip to remove corner region, union with longer strip

### Lot Subdivision (LotSubdivision.ts)

1. For each strip, generate perpendicular splitting rays along street frontage (~25m spacing)
2. Slice strip polygon with each ray using `slicePolygon()` from PolygonUtils
3. Build adjacency graph between resulting polygons
4. Validate lots (min area 200m², min frontage 10m)
5. Merge invalid lots with neighbors

### BlockManager Orchestration

BlockManager (`client/engine/BlockManager.ts`) orchestrates the pipeline:
1. Listens to store changes on streetNodes/streetEdges
2. Runs block detection → offset boundary → strip generation → lot subdivision
3. Caches results for DebugRenderer and future systems
4. Full rebuild with 300ms debounce (incremental updates planned for future)

**Debug visualization**: Orange lines show strips, yellow lines show lots.

Files: `shared/procgen/StripGeneration.ts`, `shared/procgen/LotSubdivision.ts`, `shared/procgen/PolygonUtils.ts`, `client/engine/BlockManager.ts`

---

## Beta Strips Implementation - Work In Progress

The beta strips corner-swapping algorithm is partially implemented but not yet producing correct results.

### Current State

**What's working:**
- Straight skeleton computation via `straight-skeleton-geojson` ✅
- Alpha strip generation (skeleton faces associated with input edges) ✅
- Adjacent pair detection (finding strips that share skeleton edges) ✅
- Slicing line calculation for corner transfer ✅
- Polygon slicing with `slicePolygon()` ✅
- DebugRenderer store listeners fixed (rebuilds on street changes) ✅

**What's not working:**
- Polygon union after corner transfer fails in most cases
- Result: triangular skeleton faces visible in debug view instead of rectangular strips

### Root Cause Analysis

The corner transfer algorithm:
1. Slices the source strip to create a "transfer region"
2. Attempts to union the transfer region with the destination strip
3. Union fails because the polygons share a **partial edge overlap**, not an exact edge match

**Example from debug logs:**
```
poly1 (dest): (27.5,27.5) (10.0,45.0) (10.0,10.0)
poly2 (transfer): (18.8,36.3) (27.5,27.5) (45.0,45.0) (27.5,45.0)
sharedEdge: (27.5,27.5) -> (18.8,36.3)  // partial overlap
```

The shared edge is a segment from the center point partway toward a corner, but:
- In poly1, this is part of a longer edge `(27.5,27.5) -> (10.0,45.0)`
- In poly2, this is the full edge `(18.8,36.3) -> (27.5,27.5)`

### Attempted Fixes

1. **Fixed `findSharedEdge` to return actual overlap segment** - Changed from returning the full edge from poly1 to computing the actual overlapping segment using projection.

2. **Rewrote `mergePolygonsAlongSharedEdge`** - New algorithm:
   - Find vertices in each polygon that lie on/near the shared edge
   - Walk around poly1 skipping the shared portion
   - Walk around poly2 skipping the shared portion
   - Deduplicate vertices

3. **Added tiebreaker for equal-length edges** - For square blocks where all edges have the same length, use edge index as tiebreaker to still perform corner transfers.

### Next Steps to Try

1. **Add more debug logging** to the new merge algorithm to see why it's still failing

2. **Use a proper polygon boolean library** (e.g., `clipper-lib`, `polybooljs`, or `polygon-clipping`) instead of custom union code

3. **Alternative approach**: Instead of slicing + union, directly construct the beta strip polygon by:
   - Finding the corner point (where skeleton edges meet)
   - Computing the new corner cut line
   - Building the merged polygon from scratch using known geometry

4. **Simplify for rectangular blocks**: For 4-sided blocks, could use a simpler algorithm that doesn't rely on polygon boolean operations

### Debug Logging Currently Active

The following console logs are enabled for debugging:
- `StripGeneration.ts`: Face vertex counts, adjacent pairs, beta strip processing details
- `PolygonUtils.ts`: Union failures with polygon vertices and shared edge info
- `BlockManager.ts`: Block/strip/lot counts

### Files Involved

- `shared/procgen/StripGeneration.ts` - Alpha/beta strip generation
- `shared/procgen/PolygonUtils.ts` - `slicePolygon()`, `unionPolygons()`, `findSharedEdge()`
- `shared/procgen/LotSubdivision.ts` - Strip → lot subdivision
- `client/engine/BlockManager.ts` - Orchestration and caching
- `client/engine/DebugRenderer.ts` - Visualization (strips=orange, lots=yellow)

---

## Remaining Technical Debt

- **Beta strips corner transfer**: Polygon union not working correctly (see above)

- **Incremental updates**: StreetManager and BuildingManager rebuild all geometry on any change. Should track dirty entities and only rebuild affected geometry.

- **Transport mode extensibility**: TransportGraphUtils is designed for extensibility but currently hardcoded to street tables. When adding rail/pedestrian, will need to parameterize table names.

---

## Success Criteria

Phase 1 is complete when:

1. ✅ Street network maintains graph integrity (all intersections have nodes)
2. ✅ Block detection produces valid cycles from connected streets
3. ✅ Lot subdivision produces valid lots from detected blocks
4. ✅ Debug visualization confirms algorithms working correctly
5. ⏳ Two clients can sync edits through the Durable Object (implemented but untested)
6. ✅ Multi-way intersection geometry renders correctly
7. ✅ Block boundaries correctly account for street widths
