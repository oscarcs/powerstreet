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
| Main axis algorithm with terminal modification | `shared/procgen/StripGeneration.ts` |

### Remaining Work

| Task | Notes |
|------|-------|
| Non-quadrilateral polygon handling | Main axis works for simple quads; complex polygons need refinement |
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

Strip generation divides a city block into two strips using a "main axis" derived from the straight skeleton. Each strip has street frontage on one of the long edges, suitable for lot subdivision.

### Main Axis Algorithm (StripGeneration.ts)

Based on Vanegas et al. with "Terminal Modification" to fix corner-to-corner issues:

```
ALGORITHM CalculateMainAxis(Skeleton S, Polygon P)

    // 1. BUILD GRAPH from skeleton segments
    // Extract internal edges (not on polygon boundary) from skeleton faces
    Graph G = BuildGraphFromSkeletonSegments(S)

    // 2. FIND LONGEST PATH using double BFS (tree diameter)
    // This gives us the >-< shape path through the skeleton
    // Problem: raw path goes corner-to-corner through diagonal forks
    Path longestPath = FindTreeDiameter(G)

    // 3. IDENTIFY SHORT EDGES (the "opposing block edges")
    // Sort polygon edges by length
    // Find the two shortest NON-ADJACENT edges (the "ends" of the block)
    (Edge short1, Edge short2) = FindOpposingShortEdges(P)

    // 4. TERMINAL MODIFICATION (the key fix)
    // Replace the diagonal fork endpoints with midpoints of short edges
    // This snaps the axis to run between the block "ends"
    longestPath[0] = Midpoint(short1)
    longestPath[last] = Midpoint(short2)

    RETURN longestPath
```

**Why Terminal Modification?**
- Raw skeleton longest path goes corner-to-corner (diagonal)
- The skeleton has "forks" at each end reaching to corners
- We want the axis between the two short edges (block ends)
- Solution: replace fork endpoints with short edge midpoints

### Beta Strip Generation

Once the main axis is calculated:
1. Slice the offset block polygon along the main axis using `slicePolygon()`
2. This produces exactly two beta strips
3. Each strip has frontage on one of the long edges

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

### Debug Output

The `StripDebugOutput` interface provides visibility into the algorithm:
- `skeletonSegments`: Internal skeleton edges extracted from faces
- `mainAxis`: The computed main axis polyline after terminal modification
- `alphaStrips`: Raw skeleton faces (one per input edge)
- `betaStrips`: Final strips after main axis splitting

### Known Limitations

- Works well for simple quadrilateral blocks
- Non-quadrilateral polygons (5+ sides, irregular shapes) may not find correct opposing short edges
- Fallback: extends raw longest path to boundary if short edge detection fails

### Files

- `shared/procgen/StripGeneration.ts` - Main axis algorithm, skeleton processing
- `shared/procgen/PolygonUtils.ts` - Helper functions (slicePolygon, etc.)
- `client/engine/BlockManager.ts` - Orchestration

---

## Remaining Technical Debt

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
