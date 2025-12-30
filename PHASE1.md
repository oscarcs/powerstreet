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
| Auto-rebuild blocks on street changes | `client/engine/DebugRenderer.ts` |
| Multi-way intersection geometry | `client/geometry/IntersectionGeometry.ts`, `client/engine/StreetManager.ts` |
| Block boundary offset for street widths | `shared/procgen/BlockDetection.ts`, `client/engine/DebugRenderer.ts` |

### Remaining Work

| Task | Notes |
|------|-------|
| Straight skeleton for proper strip generation | Using simplified perpendicular-ray subdivision instead |
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

## Lot Subdivision Algorithm

Uses perpendicular ray subdivision:
1. Find street-facing edges of block
2. Cast perpendicular rays inward at regular intervals (default: 25m)
3. Slice block polygon with rays to create lots
4. Merge undersized lots with neighbors

File: `shared/procgen/LotSubdivision.ts`

---

## Remaining Technical Debt

- **Straight skeleton**: The viz project uses `straight-skeleton-geojson` for proper strip generation. Current implementation uses simplified perpendicular rays which works for rectangular blocks but fails for irregular shapes.

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
