/**
 * Block Detection Algorithm
 *
 * Detects enclosed polygonal blocks from a planar street graph.
 * Uses the "minimal cycle traversal" approach where we trace along edges
 * always taking the rightmost turn at each intersection.
 */

export interface Point2D {
    x: number;
    z: number;
}

export interface GraphNode {
    id: string;
    x: number;
    z: number;
}

export interface GraphEdge {
    id: string;
    startNodeId: string;
    endNodeId: string;
    width?: number; // Street width (for offset calculations)
}

export interface DetectedBlock {
    id: string;
    nodeIds: string[]; // Ordered list of node IDs forming the boundary
    edgeIds: string[]; // Edge IDs forming the boundary
    polygon: Point2D[]; // Coordinates of the boundary polygon
    area: number; // Signed area (positive = counter-clockwise)
    isExterior: boolean; // True if this is the unbounded exterior face
}

/**
 * Represents a directed half-edge for cycle traversal.
 */
interface HalfEdge {
    edgeId: string;
    fromNodeId: string;
    toNodeId: string;
}

/**
 * Detect all blocks (enclosed faces) in a planar street graph.
 *
 * @param nodes Map of node ID to node data
 * @param edges Map of edge ID to edge data
 * @returns Array of detected blocks
 */
export function detectBlocks(
    nodes: Map<string, GraphNode>,
    edges: Map<string, GraphEdge>
): DetectedBlock[] {
    if (nodes.size === 0 || edges.size === 0) {
        return [];
    }

    // Build adjacency: for each node, store outgoing half-edges sorted by angle
    const adjacency = buildSortedAdjacency(nodes, edges);

    // Find all minimal cycles using the rightmost-turn rule
    const cycles = findAllCycles(nodes, adjacency);

    // Convert cycles to blocks
    const blocks: DetectedBlock[] = [];
    for (let i = 0; i < cycles.length; i++) {
        const cycle = cycles[i];
        const polygon = cycle.nodeIds.map((nodeId) => {
            const node = nodes.get(nodeId)!;
            return { x: node.x, z: node.z };
        });
        const area = computeSignedArea(polygon);

        blocks.push({
            id: `block_${i}`,
            nodeIds: cycle.nodeIds,
            edgeIds: cycle.edgeIds,
            polygon,
            area,
            isExterior: false, // Will be set below
        });
    }

    // The exterior block is the one with the largest absolute area
    // and typically has negative signed area (clockwise winding)
    if (blocks.length > 0) {
        let maxAbsArea = 0;
        let exteriorIndex = 0;
        for (let i = 0; i < blocks.length; i++) {
            const absArea = Math.abs(blocks[i].area);
            if (absArea > maxAbsArea) {
                maxAbsArea = absArea;
                exteriorIndex = i;
            }
        }
        blocks[exteriorIndex].isExterior = true;
    }

    return blocks;
}

/**
 * Build adjacency list with outgoing edges sorted by angle.
 */
function buildSortedAdjacency(
    nodes: Map<string, GraphNode>,
    edges: Map<string, GraphEdge>
): Map<string, HalfEdge[]> {
    const adjacency = new Map<string, HalfEdge[]>();

    // Initialize empty arrays for all nodes
    for (const nodeId of nodes.keys()) {
        adjacency.set(nodeId, []);
    }

    // Add both directions for each edge
    for (const [edgeId, edge] of edges) {
        const startNode = nodes.get(edge.startNodeId);
        const endNode = nodes.get(edge.endNodeId);
        if (!startNode || !endNode) continue;

        // Forward direction
        adjacency.get(edge.startNodeId)!.push({
            edgeId,
            fromNodeId: edge.startNodeId,
            toNodeId: edge.endNodeId,
        });

        // Reverse direction
        adjacency.get(edge.endNodeId)!.push({
            edgeId,
            fromNodeId: edge.endNodeId,
            toNodeId: edge.startNodeId,
        });
    }

    // Sort outgoing edges by angle for each node
    for (const [nodeId, halfEdges] of adjacency) {
        const node = nodes.get(nodeId)!;
        halfEdges.sort((a, b) => {
            const toA = nodes.get(a.toNodeId)!;
            const toB = nodes.get(b.toNodeId)!;
            const angleA = Math.atan2(toA.z - node.z, toA.x - node.x);
            const angleB = Math.atan2(toB.z - node.z, toB.x - node.x);
            return angleA - angleB;
        });
    }

    return adjacency;
}

/**
 * Find all minimal cycles using the rightmost-turn rule.
 */
function findAllCycles(
    nodes: Map<string, GraphNode>,
    adjacency: Map<string, HalfEdge[]>
): Array<{ nodeIds: string[]; edgeIds: string[] }> {
    const cycles: Array<{ nodeIds: string[]; edgeIds: string[] }> = [];
    const visitedHalfEdges = new Set<string>();

    // Create a unique key for a half-edge
    const halfEdgeKey = (from: string, to: string) => `${from}->${to}`;

    // For each half-edge that hasn't been visited, trace a cycle
    for (const [, halfEdges] of adjacency) {
        for (const startHalfEdge of halfEdges) {
            const key = halfEdgeKey(startHalfEdge.fromNodeId, startHalfEdge.toNodeId);
            if (visitedHalfEdges.has(key)) continue;

            // Trace cycle starting from this half-edge
            const cycle = traceCycle(nodes, adjacency, startHalfEdge, visitedHalfEdges, halfEdgeKey);
            if (cycle) {
                cycles.push(cycle);
            }
        }
    }

    return cycles;
}

/**
 * Trace a single cycle starting from a half-edge, using the rightmost-turn rule.
 */
function traceCycle(
    nodes: Map<string, GraphNode>,
    adjacency: Map<string, HalfEdge[]>,
    startHalfEdge: HalfEdge,
    visitedHalfEdges: Set<string>,
    halfEdgeKey: (from: string, to: string) => string
): { nodeIds: string[]; edgeIds: string[] } | null {
    const nodeIds: string[] = [startHalfEdge.fromNodeId];
    const edgeIds: string[] = [];

    let currentHalfEdge = startHalfEdge;
    const maxIterations = adjacency.size * 2; // Safety limit
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations++;

        const key = halfEdgeKey(currentHalfEdge.fromNodeId, currentHalfEdge.toNodeId);
        visitedHalfEdges.add(key);
        edgeIds.push(currentHalfEdge.edgeId);

        const currentToNode = currentHalfEdge.toNodeId;

        // Check if we've completed the cycle
        if (currentToNode === startHalfEdge.fromNodeId && nodeIds.length > 2) {
            // Cycle complete - don't add the start node again
            return { nodeIds, edgeIds };
        }

        nodeIds.push(currentToNode);

        // Find the next half-edge using the rightmost-turn rule
        const nextHalfEdge = findNextHalfEdge(
            nodes,
            adjacency,
            currentHalfEdge.fromNodeId,
            currentHalfEdge.toNodeId
        );

        if (!nextHalfEdge) {
            // Dead end - this shouldn't happen in a well-formed graph
            return null;
        }

        currentHalfEdge = nextHalfEdge;
    }

    // Max iterations reached - cycle is too long or infinite loop
    return null;
}

/**
 * Find the next half-edge using the rightmost-turn rule.
 *
 * Given we arrived at `toNodeId` from `fromNodeId`, find the next edge
 * that represents the "rightmost turn" (or equivalently, the edge that
 * comes next in counter-clockwise order from the reverse of our incoming edge).
 */
function findNextHalfEdge(
    _nodes: Map<string, GraphNode>,
    adjacency: Map<string, HalfEdge[]>,
    fromNodeId: string,
    toNodeId: string
): HalfEdge | null {
    const outgoingEdges = adjacency.get(toNodeId);
    if (!outgoingEdges || outgoingEdges.length === 0) return null;

    // Find the index of the reverse edge (going back to fromNodeId)
    const reverseIndex = outgoingEdges.findIndex((e) => e.toNodeId === fromNodeId);

    if (reverseIndex === -1) {
        // No reverse edge found - graph is malformed, return first edge
        return outgoingEdges[0];
    }

    // The "rightmost turn" in our CCW-sorted list is the NEXT edge after the reverse
    // This gives us the edge immediately counter-clockwise from our incoming direction
    const nextIndex = (reverseIndex + 1) % outgoingEdges.length;
    return outgoingEdges[nextIndex];
}

/**
 * Compute the signed area of a polygon.
 * Positive = counter-clockwise, Negative = clockwise.
 */
function computeSignedArea(polygon: Point2D[]): number {
    if (polygon.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i].x * polygon[j].z;
        area -= polygon[j].x * polygon[i].z;
    }

    return area / 2;
}

/**
 * Filter blocks to only include interior (non-exterior) blocks.
 */
export function getInteriorBlocks(blocks: DetectedBlock[]): DetectedBlock[] {
    return blocks.filter((b) => !b.isExterior);
}

/**
 * Get the exterior block (unbounded face).
 */
export function getExteriorBlock(blocks: DetectedBlock[]): DetectedBlock | null {
    return blocks.find((b) => b.isExterior) || null;
}

/**
 * Compute the centroid of a block.
 */
export function getBlockCentroid(block: DetectedBlock): Point2D {
    if (block.polygon.length === 0) {
        return { x: 0, z: 0 };
    }

    let sumX = 0;
    let sumZ = 0;
    for (const point of block.polygon) {
        sumX += point.x;
        sumZ += point.z;
    }

    return {
        x: sumX / block.polygon.length,
        z: sumZ / block.polygon.length,
    };
}

/**
 * Offset a block's boundary inward by half the street width on each edge.
 *
 * This produces the actual buildable land area by insetting from the
 * centerline-based block boundary.
 *
 * @param block The detected block (from centerline nodes)
 * @param edges Map of edge ID to edge data (must include width)
 * @param defaultWidth Default street width if edge has no width specified
 * @returns Offset polygon, or null if the result is degenerate
 */
export function offsetBlockBoundary(
    block: DetectedBlock,
    edges: Map<string, GraphEdge>,
    defaultWidth: number = 10
): Point2D[] | null {
    const n = block.polygon.length;
    if (n < 3) return null;

    // Determine winding direction: positive area = CCW, negative = CW
    const originalArea = computeSignedArea(block.polygon);
    const isCCW = originalArea > 0;

    // Get width for each edge in the block boundary
    const edgeWidths: number[] = block.edgeIds.map(edgeId => {
        const edge = edges.get(edgeId);
        return edge?.width ?? defaultWidth;
    });

    // For each vertex in the block polygon, we need to compute the inset point.
    // The vertex is where two edges meet. We offset each edge inward by half its
    // width, then find where the offset lines intersect (miter point).
    const offsetPolygon: Point2D[] = [];

    for (let i = 0; i < n; i++) {
        const prevIdx = (i - 1 + n) % n;

        // Current vertex and adjacent vertices
        const curr = block.polygon[i];
        const prev = block.polygon[prevIdx];
        const next = block.polygon[(i + 1) % n];

        // Edge before this vertex (prevIdx -> i) and edge after (i -> i+1)
        // In the block polygon, edgeIds[i] connects polygon[i] to polygon[i+1]
        const edgeBefore = edgeWidths[prevIdx]; // Edge from prev to curr
        const edgeAfter = edgeWidths[i];        // Edge from curr to next

        const offsetPoint = computeInsetCorner(
            prev, curr, next,
            edgeBefore / 2,
            edgeAfter / 2,
            isCCW
        );

        if (!offsetPoint) {
            return null; // Degenerate geometry
        }

        offsetPolygon.push(offsetPoint);
    }

    // Check if the offset polygon is valid (same winding as original)
    const offsetArea = computeSignedArea(offsetPolygon);

    // If offset area has opposite sign or is too small, the polygon is degenerate
    if (Math.sign(offsetArea) !== Math.sign(originalArea) || Math.abs(offsetArea) < 1) {
        return null;
    }

    return offsetPolygon;
}

/**
 * Compute the inset corner point where two offset edges meet.
 *
 * @param prev Previous vertex in polygon
 * @param curr Current vertex (the corner)
 * @param next Next vertex in polygon
 * @param offsetBefore Inset distance for edge before corner
 * @param offsetAfter Inset distance for edge after corner
 * @param isCCW True if polygon has counter-clockwise winding
 * @returns The miter point, or null if degenerate
 */
function computeInsetCorner(
    prev: Point2D,
    curr: Point2D,
    next: Point2D,
    offsetBefore: number,
    offsetAfter: number,
    isCCW: boolean
): Point2D | null {
    // Direction vectors for edges
    const d1x = curr.x - prev.x;
    const d1z = curr.z - prev.z;
    const len1 = Math.sqrt(d1x * d1x + d1z * d1z);

    const d2x = next.x - curr.x;
    const d2z = next.z - curr.z;
    const len2 = Math.sqrt(d2x * d2x + d2z * d2z);

    if (len1 < 0.001 || len2 < 0.001) {
        return null; // Degenerate edge
    }

    // Unit direction vectors
    const u1x = d1x / len1;
    const u1z = d1z / len1;
    const u2x = d2x / len2;
    const u2z = d2z / len2;

    // Perpendicular normals pointing inward
    // In X-Z plane viewed from +Y: CCW polygon has interior on LEFT of edge direction
    // Left perpendicular of (dx, dz) is (-dz, dx)
    // For CW winding: interior is on RIGHT, so use (dz, -dx)
    const sign = isCCW ? -1 : 1;
    const n1x = u1z * sign;  // For CCW: -u1z (left perp)
    const n1z = -u1x * sign; // For CCW: u1x (left perp)
    const n2x = u2z * sign;
    const n2z = -u2x * sign;

    // Points on the offset lines at the current vertex
    const p1x = curr.x + n1x * offsetBefore;
    const p1z = curr.z + n1z * offsetBefore;
    const p2x = curr.x + n2x * offsetAfter;
    const p2z = curr.z + n2z * offsetAfter;

    // Find intersection of the two offset lines
    // Line 1: p1 + t * u1
    // Line 2: p2 + s * u2
    const cross = u1x * u2z - u1z * u2x;

    if (Math.abs(cross) < 0.0001) {
        // Lines are parallel (edges are collinear)
        // Return midpoint of the two offset points
        return {
            x: (p1x + p2x) / 2,
            z: (p1z + p2z) / 2
        };
    }

    // Solve for t: p1 + t*u1 = p2 + s*u2
    const dx = p2x - p1x;
    const dz = p2z - p1z;
    const t = (dx * u2z - dz * u2x) / cross;

    const miterX = p1x + t * u1x;
    const miterZ = p1z + t * u1z;

    // Clamp the miter if it extends too far (acute angle)
    const miterDist = Math.sqrt(
        (miterX - curr.x) * (miterX - curr.x) +
        (miterZ - curr.z) * (miterZ - curr.z)
    );
    const maxOffset = Math.max(offsetBefore, offsetAfter);
    const maxMiterDist = maxOffset * 3; // Limit miter extension

    if (miterDist > maxMiterDist) {
        // Scale back the miter point
        const scale = maxMiterDist / miterDist;
        return {
            x: curr.x + (miterX - curr.x) * scale,
            z: curr.z + (miterZ - curr.z) * scale
        };
    }

    return { x: miterX, z: miterZ };
}
