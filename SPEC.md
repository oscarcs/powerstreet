# Specifications and planning document

This is a project to create a city builder. The gimmick is that it will be substantially more realistic than previous city builders. It should feel like something a bit closer to a grand strategy game or other 'spreadsheet simulator' genre than previous offerings.

Implementation is still at early stages, and many things still need quite a bit of work.

## Current status

We have implemented a basic prototype using Three.js that includes building rendering, some basic lighting, and very basic building and road editing tools. UI is facilitated by React, but we are not using react-three-fiber. We are simultaneously building a backend system, named 'worldsync'; the purpose of this is to enable real-time multiplayer. TinyBase is being used to help facilitate sync operations. Cloudflare Workers and Durable Objects are being used as the infrastructure layer.

The datastructures currently used to represent things like buildings are fairly tentative and some additional work could be done here to think about performance, live editing and sync, and so on.

---

## Technical Design Decisions

This section documents key architectural and design decisions made during planning.

### Visual Style

The visual aesthetic is **minimal, Google Maps-style**:
- Buildings are basic extrusions with optional segmentation (already partially implemented)
- No photorealistic PBR materials; clean, readable silhouettes
- **Color encodes information**: buildings change color to visualize data (e.g., lighter green = higher property values, red = declining, etc.)
- This aligns with the "spreadsheet simulator" vision where visuals serve data comprehension

### World Structure

**Fixed large map (~25 km², supporting 10,000–50,000 lots)**:
- Pre-defined world boundaries, subdivided into tiles for rendering and simulation
- Not infinite/procedural chunks; bounded scope simplifies many systems
- Tile subdivision enables LOD, culling, and efficient sync

**Terrain model: Hybrid grid + smooth rendering**
- Discrete elevation grid points for simulation (like SimCity 4)
- Smooth interpolation for rendering between grid points
- Sea level threshold for water rendering
- Grid points are editable by players

### Street Network Data Model

**Graph-first architecture**:
- Nodes store positions (intersections, endpoints)
- Edges store metadata: road type, width, speed limit, elevation
- Geometry is **derived** from the graph for rendering
- This guarantees clean topology for lot subdivision and pathfinding
- Curved roads handled via edge metadata (control points or arc parameters)

Benefits:
- Subdivision algorithms can trust topology without detecting intersections
- Sync is simpler (node/edge IDs rather than polyline diffs)
- Pathfinding operates directly on the graph

### Lot Subdivision

**Rule-based, district-specific subdivision**:
- Players do NOT "paint" zones directly onto individual lots
- Instead, players define subdivision rules at the district/legislation level
- The street grid is directly editable, but lot boundaries within blocks are computed from rules
- Manual override for individual lots is permitted but not the primary workflow

**Subdivision rule parameters (per district)**:
- Minimum/maximum lot frontage
- Minimum lot area
- Depth ratios
- Corner lot handling
- Flag lot rules
- Easement requirements

The lot subdivision code from the `/procgen` directory of the viz project should be ported. The algorithms should already work with non-geographic coordinates with minimal adaptation.

### Zoning and Building Rules

Zoning is **district-based legislation**, not painted zones:
- Each district defines: height limits, setback requirements, FAR (floor area ratio), allowed land uses
- Mixed-use is supported: different rules can apply to different building sections (ground floor retail + residential above)
- Changing rules doesn't instantly morph buildings; players must manually trigger reconstruction (eventually this becomes simulation-driven through economic pressure)

### Building Generation

**Hybrid approach by density/importance**:
- **Generic buildings**: Procedurally generated from zoning rules (extrusions with optional segmentation)
- **Landmarks/special buildings**: Artist-authored models placed according to rules
- Building colors dynamically reflect simulation data (property values, vacancy, etc.)

---

## Economic Simulation

### Market Model

**Full market simulation with property-level detail**:
- Each lot/building tracks: current rent, vacancy rate, ownership status, property value, construction cost history
- Aggregate actors (not individual named agents): "developer pool," "tenant demand curves"
- Rents, vacancy rates, construction costs, and financing rates drive development decisions

This creates emergent redevelopment pressure: when potential land value (based on zoning allowances) exceeds current use value + demolition cost, market forces push for redevelopment.

### Simulation Timing

**Discrete periodic ticks**:
- Economic simulation updates on monthly/quarterly ticks
- Traffic simulation runs more frequently (but still discrete)
- Demographics and population changes run slower (yearly)
- This approach is predictable, debuggable, and scales better than continuous real-time

### Traffic Simulation

**Flow-based model**:
- Road segments have capacity; traffic modeled as fluid flow
- Origin-destination matrices drive demand
- No individual vehicle agents (too expensive at city scale)
- Visual feedback through color-coded congestion on roads

### Utilities

**Abstract budget model**:
- Utilities (power, water, sewer) are recurring costs and coverage percentages
- Not modeled as networks with physics (voltage drop, pressure)
- This keeps focus on the core differentiators: market simulation and political mechanics

---

## Multiplayer Architecture

### Sync Strategy

**Hybrid approach**:
- **Last-write-wins** for simple, fast-rendering operations (most common edits)
- **Locks or CRDTs** for complex overlapping geometry edits where conflicts would be destructive
- TinyBase facilitates reactive client-side state with sync to Durable Objects

### Persistence

**Durable Objects for now**:
- All live state stored in Cloudflare Durable Objects
- Historical data (legislative votes, economic history) also in DO storage initially
- Scaling to external database (Postgres) deferred until necessary

### Multiplayer Mode

**Cooperative with roles + political simulation**:

Players share one city but have different responsibilities. Rather than rigid role assignments, the system includes a **full city council legislative simulation**:

- **Directly editable elements**: Streets, some infrastructure (varies by game settings)
- **Requires legislative vote**: Zoning changes, tax rates, budget allocation, major projects
- **Vote mechanics**: Proposals submitted, council votes, majority rules (or supermajority for major changes)
- **Failed votes**: Can be resubmitted (game settings may impose cooldowns or consequences)

This creates genuine political dynamics: players must build consensus, trade favors, and compromise.

### Game Time

**Adjustable speed**:
- Host or player consensus controls game speed
- Pausing allowed for complex decisions, votes, planning
- Standard approach for multiplayer strategy games

---

## Rendering Architecture

### Scale Challenge

With 10,000–50,000 buildings, naive rendering won't work. Two key techniques:

### Tile-Based Rendering

Investigate **3D Tiles** (Cesium standard) techniques:
- Bounding volume hierarchy for spatial culling
- Geometric error metrics for LOD decisions
- Tile streaming/loading based on camera position
- If existing 3D Tiles libraries (loaders.gl, etc.) integrate well with live editing, use them
- Otherwise, borrow the concepts: BVH structure, LOD hierarchy, tile format for a custom implementation

### Instanced Rendering

- Buildings of similar type batched into instanced meshes
- Per-instance attributes: position, scale, color (for data visualization)
- Reduces draw calls dramatically

### Shadows and Lighting

- Consider shadow cascades for large maps
- May need to disable shadows for distant tiles
- Simple ambient + directional lighting sufficient for minimal aesthetic

---

## Transport System Architecture

### Multimodal Transport

The system should support: roads, metros, light rail, pedestrian paths, elevated structures (overpasses, flyovers).

**Shared constraint system** (not just rendering):
- Common geometric constraint solver
- Per-type parameters: minimum curve radius, maximum grade, station requirements
- Unified transport graph with typed edges
- Shared pathfinding that respects mode transfers

This enables true multimodal simulation: a commute can include walking → metro → bus → walking.

### Elevated Structures

- Same graph-first approach as ground-level streets
- Elevation stored as node/edge attribute
- Rendering generates appropriate geometry (pillars, ramps, etc.)
- Constraint system prevents impossible geometry (rail with too-tight curves)

---

## Data Import/Export

### Real World Data

**Nice to have, not priority**:
- Potential to import OSM street networks, parcel data
- Would enable "play your own city" scenarios
- Deferred until core systems stable
- Coordinate conversion challenges (geographic ↔ local) already explored in viz project

### Export

- May be valuable to export player cities to GIS formats
- Lower priority than import

---

## Extensibility

**Data-driven architecture preferred, explicit modding support not a priority**:
- Design with clean data separation where practical
- Configuration files for tuning (balance, rules, parameters)
- Plugin architecture not required initially
- If successful, modding support could be added later

---

## Testing and Balance

**Live data tuning strategy**:
- Release early, iterate based on real player behavior
- Automated simulation runs can identify degenerate strategies
- Unit tests for critical simulation math (rent calculations, traffic flow)
- Accept that first impressions may be rough; prioritize iteration speed

---

## Implementation Priorities

Based on the identified risks (multiplayer sync + rendering at scale being interconnected), the recommended prototype sequence is:

### Phase 1: Data Structure Foundation
1. Implement graph-first street network data model
2. Design spatial indexing that serves both rendering (tile queries) and sync (delta computation)
3. Port lot subdivision algorithms from viz project
4. Establish TinyBase ↔ Durable Objects sync patterns

### Phase 2: Rendering at Scale
1. Implement tile-based rendering with LOD
2. Test with 10K+ procedurally generated buildings
3. Investigate 3D Tiles integration or concept adaptation
4. Implement instanced rendering for buildings

### Phase 3: Multiplayer Validation
1. Test sync performance with multiple clients editing simultaneously
2. Implement lock/CRDT mechanisms for conflict-prone operations
3. Validate that rendering tiles and sync deltas align efficiently

### Phase 4: Core Simulation
1. Implement property-level economic tracking
2. Build flow-based traffic simulation
3. Connect simulation to building generation triggers

### Phase 5: Political Layer
1. Implement legislative proposal system
2. Build voting mechanics
3. Connect votes to rule changes that affect simulation

### Later Phases
- Terrain editing
- Multimodal transport
- Real data import
- Onboarding/tutorials
- Balance tuning from live data

---

## Open Questions

- **Exact 3D Tiles integration path**: Need to prototype whether loaders.gl or similar can work with live editing, or if a custom implementation borrowing concepts is cleaner
- **CRDT library choice**: For complex geometric conflict resolution, may need spatial-aware CRDT implementation
- **District boundary editing UX**: How do players define and modify district boundaries for zoning rules?
- **Legislative proposal UI**: What does the interface for proposing, debating, and voting on legislation look like?
- **Save/load**: Single player save games, multiplayer session persistence, scenario presets

---

## Reference Code

The viz project at `~/Dev/viz` (github.com/oscarcs/viz) contains:
- `/procgen`: Lot subdivision algorithms to port
- deck.gl-based rendering (concepts may inform 3D Tiles approach)
- Geographic coordinate handling (mostly to avoid, but useful for potential import features)
