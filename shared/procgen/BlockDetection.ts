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
