/**
 * Strip Generation Algorithm
 *
 * Generates strips from city blocks using the straight skeleton algorithm.
 * Uses a "main axis" approach: finds the longest path through the skeleton
 * graph and splits the block into two strips along that axis.
 *
 * Pipeline:
 * 1. Compute straight skeleton of the block
 * 2. Extract skeleton segments from face boundaries
 * 3. Calculate main axis (longest path through skeleton graph)
 * 4. Extend main axis to block boundary
 * 5. Split block into two beta strips along main axis
 */

import { StraightSkeletonBuilder, Vector2d, List } from "straight-skeleton-geojson";
import { DetectedBlock, Point2D, GraphEdge } from "./BlockDetection";
import { slicePolygon } from "./PolygonUtils";

export interface Strip {
    id: string;
    polygon: Point2D[];
    blockId: string;
    streetEdgeId: string;
    streetEdgeSegment: [Point2D, Point2D];
    area: number;
}

interface AlphaStrip {
    id: string;
    polygon: Point2D[];
    blockId: string;
    edgeIndex: number; // Index in the original block polygon
    streetEdgeId: string;
    streetEdgeSegment: [Point2D, Point2D];
}

export interface StripGenerationOptions {
    skipBetaStrips?: boolean; // If true, return alpha strips without corner transfer (for debugging)
    debugOutput?: StripDebugOutput; // If provided, detailed debug info is written here
}

export interface StripDebugOutput {
    blockId: string;
    alphaStrips: Array<{ id: string; polygon: Point2D[]; area: number; streetEdgeId: string; edgeIndex: number; edgeLength: number }>;
    skeletonSegments: Array<[Point2D, Point2D]>;
    mainAxis: Point2D[];
    betaStrips: Array<{ id: string; polygon: Point2D[]; area: number }>;
    errors: string[];
}

/**
 * Generate strips for a block using the straight skeleton algorithm.
 *
 * @param block The detected block
 * @param offsetPolygon The block polygon offset inward by street widths
 * @param edges Map of edge ID to edge data
 * @param options Optional generation options
 * @returns Array of strips
 */
export function generateStrips(
    block: DetectedBlock,
    offsetPolygon: Point2D[],
    edges: Map<string, GraphEdge>,
    options: StripGenerationOptions = {}
): Strip[] {
    const debug = options.debugOutput;
    if (debug) {
        debug.blockId = block.id;
        debug.alphaStrips = [];
        debug.skeletonSegments = [];
        debug.mainAxis = [];
        debug.betaStrips = [];
        debug.errors = [];
    }

    if (offsetPolygon.length < 3) {
        return [];
    }

    // Step 1: Generate skeleton and alpha strips
    const skeletonResult = generateSkeletonWithSegments(block, offsetPolygon, edges);

    if (!skeletonResult) {
        debug?.errors.push("Failed to generate skeleton");
        return [];
    }

    const { alphaStrips, skeletonSegments } = skeletonResult;

    if (debug) {
        debug.alphaStrips = alphaStrips.map(s => ({
            id: s.id,
            polygon: s.polygon,
            area: computePolygonArea(s.polygon),
            streetEdgeId: s.streetEdgeId,
            edgeIndex: s.edgeIndex,
            edgeLength: edgeLength(s.streetEdgeSegment)
        }));
        debug.skeletonSegments = skeletonSegments;
    }

    // If skipping beta strips, return alpha strips directly
    if (options.skipBetaStrips) {
        return alphaStrips.map((strip) => ({
            id: strip.id,
            polygon: strip.polygon,
            blockId: strip.blockId,
            streetEdgeId: strip.streetEdgeId,
            streetEdgeSegment: strip.streetEdgeSegment,
            area: computePolygonArea(strip.polygon),
        }));
    }

    // Step 2: Calculate main axis from skeleton segments
    const mainAxis = calculateMainAxis(skeletonSegments, offsetPolygon);

    if (debug) {
        debug.mainAxis = mainAxis;
    }

    if (mainAxis.length < 2) {
        debug?.errors.push("Main axis too short, returning alpha strips");
        return alphaStrips.map((strip) => ({
            id: strip.id,
            polygon: strip.polygon,
            blockId: strip.blockId,
            streetEdgeId: strip.streetEdgeId,
            streetEdgeSegment: strip.streetEdgeSegment,
            area: computePolygonArea(strip.polygon),
        }));
    }

    // Step 3: Split block into two beta strips along main axis
    const betaStrips = splitBlockByMainAxis(block, offsetPolygon, mainAxis, alphaStrips, debug);

    if (debug) {
        debug.betaStrips = betaStrips.map(s => ({
            id: s.id,
            polygon: s.polygon,
            area: computePolygonArea(s.polygon)
        }));
    }

    // Convert to final Strip format
    return betaStrips.map((strip) => ({
        id: strip.id,
        polygon: strip.polygon,
        blockId: strip.blockId,
        streetEdgeId: strip.streetEdgeId,
        streetEdgeSegment: strip.streetEdgeSegment,
        area: computePolygonArea(strip.polygon),
    }));
}

interface SkeletonResult {
    alphaStrips: AlphaStrip[];
    skeletonSegments: [Point2D, Point2D][];
}

/**
 * Generate alpha strips and extract skeleton segments from the straight skeleton.
 * Each alpha strip corresponds to one input edge of the polygon.
 * Skeleton segments are the internal edges (spines) of the skeleton.
 */
function generateSkeletonWithSegments(
    block: DetectedBlock,
    offsetPolygon: Point2D[],
    edges: Map<string, GraphEdge>
): SkeletonResult | null {
    // Convert to Vector2d for skeleton library
    const polygonVectors = new List<Vector2d>();
    for (const p of offsetPolygon) {
        polygonVectors.add(new Vector2d(p.x, p.z));
    }

    // Build straight skeleton
    let skeleton;
    try {
        skeleton = StraightSkeletonBuilder.build(polygonVectors);
    } catch (err) {
        return null;
    }

    const skeletonEdges = skeleton.edges;
    const strips: AlphaStrip[] = [];
    const allSkeletonSegments: [Point2D, Point2D][] = [];

    // Track which segments are on the input polygon boundary
    const boundarySegmentKeys = new Set<string>();
    for (let i = 0; i < offsetPolygon.length; i++) {
        const p1 = offsetPolygon[i];
        const p2 = offsetPolygon[(i + 1) % offsetPolygon.length];
        boundarySegmentKeys.add(segmentKey(p1, p2));
    }

    for (let i = 0; i < skeletonEdges.length; i++) {
        const edgeResult = skeletonEdges[i];
        const facePolygon = edgeResult.polygon;

        if (!facePolygon || facePolygon.length < 3) {
            continue;
        }

        // Convert face polygon to Point2D
        const polygon: Point2D[] = [];
        for (let j = 0; j < facePolygon.length; j++) {
            const v = facePolygon[j];
            polygon.push({ x: v.x, z: v.y });
        }

        // Extract skeleton segments from face edges
        // (edges that are NOT on the input polygon boundary)
        for (let j = 0; j < polygon.length; j++) {
            const p1 = polygon[j];
            const p2 = polygon[(j + 1) % polygon.length];
            const key = segmentKey(p1, p2);

            // Skip boundary edges and very short edges
            if (!boundarySegmentKeys.has(key) && distance(p1, p2) > 0.1) {
                allSkeletonSegments.push([p1, p2]);
            }
        }

        // Find which input edge this face corresponds to
        const inputEdge = edgeResult.edge;
        const edgeStart: Point2D = { x: inputEdge.begin.x, z: inputEdge.begin.y };
        const edgeEnd: Point2D = { x: inputEdge.end.x, z: inputEdge.end.y };

        // Match to block edge and find street edge ID
        const edgeIndex = findMatchingEdgeIndex(offsetPolygon, edgeStart, edgeEnd);
        const streetEdgeId = findStreetEdgeId(block, edgeIndex, edges);

        strips.push({
            id: `${block.id}_strip_${i}`,
            polygon,
            blockId: block.id,
            edgeIndex,
            streetEdgeId,
            streetEdgeSegment: [edgeStart, edgeEnd],
        });
    }

    // Deduplicate skeleton segments (each internal edge appears in two faces)
    const uniqueSegments = deduplicateSegments(allSkeletonSegments);

    return { alphaStrips: strips, skeletonSegments: uniqueSegments };
}

/**
 * Create a canonical key for a segment (order-independent).
 */
function segmentKey(p1: Point2D, p2: Point2D): string {
    const k1 = `${p1.x.toFixed(4)},${p1.z.toFixed(4)}`;
    const k2 = `${p2.x.toFixed(4)},${p2.z.toFixed(4)}`;
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

/**
 * Deduplicate segments based on their endpoints.
 */
function deduplicateSegments(segments: [Point2D, Point2D][]): [Point2D, Point2D][] {
    const seen = new Set<string>();
    const result: [Point2D, Point2D][] = [];

    for (const seg of segments) {
        const key = segmentKey(seg[0], seg[1]);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(seg);
        }
    }

    return result;
}

// ============ Main Axis Algorithm ============

interface GraphNode {
    point: Point2D;
    neighbors: { id: string; weight: number }[];
}

/**
 * Calculates the Main Axis from skeleton segments using "Terminal Modification".
 *
 * The raw longest path through a skeleton goes corner-to-corner (like >-<).
 * We fix this by replacing the endpoints with the midpoints of the opposing short edges.
 *
 * Algorithm:
 * 1. Build a graph from skeleton segments
 * 2. Find the longest path (tree diameter) - this gives us the spine direction
 * 3. Identify the two SHORT edges of the block (the "opposing block edges")
 * 4. Terminal Modification: Replace the path endpoints with the midpoints of short edges
 *
 * @param skeletonSegments Array of line segments from the skeleton
 * @param polygonBoundary The offset block polygon
 * @returns Ordered array of points representing the main axis polyline
 */
function calculateMainAxis(
    skeletonSegments: [Point2D, Point2D][],
    polygonBoundary: Point2D[]
): Point2D[] {
    if (skeletonSegments.length === 0) {
        return [];
    }

    // Step 1: Build the graph
    const adjacency = new Map<string, GraphNode>();
    const pointKey = (p: Point2D) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`;

    for (const [p1, p2] of skeletonSegments) {
        const k1 = pointKey(p1);
        const k2 = pointKey(p2);
        const w = distance(p1, p2);

        if (!adjacency.has(k1)) {
            adjacency.set(k1, { point: p1, neighbors: [] });
        }
        if (!adjacency.has(k2)) {
            adjacency.set(k2, { point: p2, neighbors: [] });
        }

        adjacency.get(k1)!.neighbors.push({ id: k2, weight: w });
        adjacency.get(k2)!.neighbors.push({ id: k1, weight: w });
    }

    // Step 2: Find the longest path (tree diameter) using double BFS
    const longestPath = findLongestPath(adjacency);
    if (longestPath.length < 2) {
        return [];
    }

    // Step 3: Identify the two SHORT edges of the block
    const shortEdges = findOpposingShortEdges(polygonBoundary);
    if (!shortEdges) {
        // Fallback: just return the raw longest path extended to boundary
        return extendPathToBoundary(longestPath, polygonBoundary);
    }

    // Step 4: Terminal Modification - snap endpoints to short edge midpoints
    // The key insight: we REPLACE the diagonal fork endpoints with the midpoints
    // of the short edges, creating a clean axis between the two ends of the block
    const result = [...longestPath];
    result[0] = shortEdges.midpoint1;
    result[result.length - 1] = shortEdges.midpoint2;

    return result;
}

/**
 * Find the longest path in the skeleton graph using double BFS.
 */
function findLongestPath(adjacency: Map<string, GraphNode>): Point2D[] {
    const getFurthestNode = (startNodeId: string) => {
        const distances = new Map<string, number>();
        const parents = new Map<string, string | null>();
        const queue: string[] = [startNodeId];

        distances.set(startNodeId, 0);
        parents.set(startNodeId, null);

        let maxDist = -1;
        let furthestId = startNodeId;

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const currentDist = distances.get(currentId)!;
            const node = adjacency.get(currentId)!;

            if (currentDist > maxDist) {
                maxDist = currentDist;
                furthestId = currentId;
            }

            for (const neighbor of node.neighbors) {
                if (!distances.has(neighbor.id)) {
                    distances.set(neighbor.id, currentDist + neighbor.weight);
                    parents.set(neighbor.id, currentId);
                    queue.push(neighbor.id);
                }
            }
        }

        return { furthestId, parents, maxDist };
    };

    const startNode = adjacency.keys().next().value;
    if (!startNode) return [];

    const pass1 = getFurthestNode(startNode);
    const pass2 = getFurthestNode(pass1.furthestId);

    // Reconstruct path
    const path: Point2D[] = [];
    let curr: string | null = pass2.furthestId;
    while (curr) {
        path.push(adjacency.get(curr)!.point);
        curr = pass2.parents.get(curr) || null;
    }

    return path;
}

interface OpposingEdges {
    midpoint1: Point2D;
    midpoint2: Point2D;
    edge1Index: number;
    edge2Index: number;
}

/**
 * Find the two short "opposing" edges of the block.
 * These are the shortest non-adjacent edges that represent the "ends" of the block.
 */
function findOpposingShortEdges(polygon: Point2D[]): OpposingEdges | null {
    if (polygon.length < 4) return null;

    // Calculate all edge lengths with their midpoints
    const edges: { index: number; length: number; midpoint: Point2D }[] = [];
    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];
        const len = distance(p1, p2);
        const midpoint: Point2D = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
        edges.push({ index: i, length: len, midpoint });
    }

    // Sort by length
    edges.sort((a, b) => a.length - b.length);

    // Find the shortest edge
    const shortEdge1 = edges[0];

    // Find the second shortest edge that is NOT adjacent to the first
    let shortEdge2: typeof shortEdge1 | null = null;
    const n = polygon.length;

    for (let i = 1; i < edges.length; i++) {
        const candidate = edges[i];
        const idx1 = shortEdge1.index;
        const idx2 = candidate.index;

        // Check if edges are adjacent (indices differ by 1, wrapping around)
        const adjacent = (idx2 === (idx1 + 1) % n) || (idx1 === (idx2 + 1) % n);

        if (!adjacent) {
            shortEdge2 = candidate;
            break;
        }
    }

    if (!shortEdge2) return null;

    return {
        midpoint1: shortEdge1.midpoint,
        midpoint2: shortEdge2.midpoint,
        edge1Index: shortEdge1.index,
        edge2Index: shortEdge2.index
    };
}

/**
 * Fallback: extend path endpoints to the polygon boundary.
 */
function extendPathToBoundary(path: Point2D[], polygon: Point2D[]): Point2D[] {
    if (path.length < 2) return path;

    const result = [...path];

    // Extend start
    const pStart = result[0];
    const pNext = result[1];
    const extendedStart = extendToBoundary(pNext, pStart, polygon);
    if (extendedStart) {
        result[0] = extendedStart;
    }

    // Extend end
    const pEnd = result[result.length - 1];
    const pPrev = result[result.length - 2];
    const extendedEnd = extendToBoundary(pPrev, pEnd, polygon);
    if (extendedEnd) {
        result[result.length - 1] = extendedEnd;
    }

    return result;
}

/**
 * Extends a ray defined by (from -> to) until it intersects the polygon boundary.
 */
function extendToBoundary(from: Point2D, to: Point2D, polygon: Point2D[]): Point2D | null {
    let dx = to.x - from.x;
    let dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) return null;

    // Normalize and scale to a large number
    dx /= len;
    dz /= len;
    const farPoint: Point2D = { x: to.x + dx * 10000, z: to.z + dz * 10000 };

    let closestIntersection: Point2D | null = null;
    let minDist = Infinity;

    // Check intersection with every polygon edge
    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        const hit = lineSegmentIntersection(to, farPoint, p1, p2);
        if (hit) {
            const d = distance(to, hit);
            if (d < minDist) {
                minDist = d;
                closestIntersection = hit;
            }
        }
    }

    return closestIntersection;
}

/**
 * Line-segment intersection. Returns the intersection point if the ray (p1->p2)
 * intersects the line segment (p3->p4).
 */
function lineSegmentIntersection(
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    p4: Point2D
): Point2D | null {
    const det = (p2.x - p1.x) * (p4.z - p3.z) - (p4.x - p3.x) * (p2.z - p1.z);
    if (det === 0) return null; // Parallel

    const lambda = ((p4.z - p3.z) * (p4.x - p1.x) + (p3.x - p4.x) * (p4.z - p1.z)) / det;
    const gamma = ((p1.z - p2.z) * (p4.x - p1.x) + (p2.x - p1.x) * (p4.z - p1.z)) / det;

    // lambda >= 0 means intersection is in front of 'to' point
    // gamma in [0,1] means intersection is on the polygon edge
    if (lambda >= 0 && gamma >= 0 && gamma <= 1) {
        return {
            x: p1.x + lambda * (p2.x - p1.x),
            z: p1.z + lambda * (p2.z - p1.z)
        };
    }
    return null;
}

/**
 * Split the block polygon into two strips along the main axis.
 * Each strip will be assigned street edges based on which side of the axis they fall.
 */
function splitBlockByMainAxis(
    block: DetectedBlock,
    offsetPolygon: Point2D[],
    mainAxis: Point2D[],
    alphaStrips: AlphaStrip[],
    debug?: StripDebugOutput
): AlphaStrip[] {
    if (mainAxis.length < 2) {
        debug?.errors.push("Main axis too short for splitting");
        return alphaStrips;
    }

    // Use the first and last points of the main axis as the slicing line
    const sliceStart = mainAxis[0];
    const sliceEnd = mainAxis[mainAxis.length - 1];

    // Slice the offset polygon along the main axis
    const sliceResult = slicePolygon(offsetPolygon, sliceStart, sliceEnd, false);

    if (sliceResult.length !== 2) {
        debug?.errors.push(`Main axis slice failed: got ${sliceResult.length} pieces instead of 2`);
        // Fall back to alpha strips
        return alphaStrips;
    }

    // Create two beta strips from the sliced polygons
    const betaStrips: AlphaStrip[] = [];

    for (let i = 0; i < sliceResult.length; i++) {
        const stripPoly = sliceResult[i];

        // Find the alpha strip(s) that best match this beta strip
        // (based on which side of the main axis they fall)
        const matchingAlpha = findBestMatchingAlphaStrip(stripPoly, alphaStrips);

        betaStrips.push({
            id: `${block.id}_beta_${i}`,
            polygon: stripPoly,
            blockId: block.id,
            edgeIndex: matchingAlpha?.edgeIndex ?? i,
            streetEdgeId: matchingAlpha?.streetEdgeId ?? `${i}`,
            streetEdgeSegment: matchingAlpha?.streetEdgeSegment ?? findLongestBoundaryEdge(stripPoly, offsetPolygon),
        });
    }

    debug?.errors.push(`Split into ${betaStrips.length} beta strips`);
    return betaStrips;
}

/**
 * Find the alpha strip that best matches a beta strip polygon based on overlap.
 */
function findBestMatchingAlphaStrip(
    betaPoly: Point2D[],
    alphaStrips: AlphaStrip[]
): AlphaStrip | null {
    const betaCentroid = polygonCentroid(betaPoly);
    let bestStrip: AlphaStrip | null = null;
    let bestScore = -Infinity;

    for (const alpha of alphaStrips) {
        // Score based on how much the alpha strip's frontage overlaps with the beta polygon
        const alphaCentroid = polygonCentroid(alpha.polygon);

        // Check if alpha centroid is roughly on the same side of block as beta centroid
        // Use distance to beta centroid as a simple heuristic
        const dist = distance(alphaCentroid, betaCentroid);
        const score = -dist; // Lower distance = better match

        if (score > bestScore) {
            bestScore = score;
            bestStrip = alpha;
        }
    }

    return bestStrip;
}

/**
 * Find the longest edge of a polygon that lies on the block boundary.
 * This represents the street frontage for the strip.
 */
function findLongestBoundaryEdge(
    stripPoly: Point2D[],
    blockBoundary: Point2D[]
): [Point2D, Point2D] {
    let longestEdge: [Point2D, Point2D] = [stripPoly[0], stripPoly[1] || stripPoly[0]];
    let maxLen = 0;

    // Build set of boundary edge keys for quick lookup
    const boundaryKeys = new Set<string>();
    for (let i = 0; i < blockBoundary.length; i++) {
        const p1 = blockBoundary[i];
        const p2 = blockBoundary[(i + 1) % blockBoundary.length];
        boundaryKeys.add(segmentKey(p1, p2));
    }

    for (let i = 0; i < stripPoly.length; i++) {
        const p1 = stripPoly[i];
        const p2 = stripPoly[(i + 1) % stripPoly.length];
        const key = segmentKey(p1, p2);
        const len = distance(p1, p2);

        // Check if this edge is on the boundary (or close to it)
        if (boundaryKeys.has(key) || isEdgeOnBoundary(p1, p2, blockBoundary)) {
            if (len > maxLen) {
                maxLen = len;
                longestEdge = [p1, p2];
            }
        }
    }

    // If no boundary edge found, just return the longest edge
    if (maxLen === 0) {
        for (let i = 0; i < stripPoly.length; i++) {
            const p1 = stripPoly[i];
            const p2 = stripPoly[(i + 1) % stripPoly.length];
            const len = distance(p1, p2);
            if (len > maxLen) {
                maxLen = len;
                longestEdge = [p1, p2];
            }
        }
    }

    return longestEdge;
}

/**
 * Check if an edge approximately lies on the polygon boundary.
 */
function isEdgeOnBoundary(p1: Point2D, p2: Point2D, boundary: Point2D[]): boolean {
    const tolerance = 0.5;

    // Check if both endpoints are close to the boundary
    const d1 = minDistanceToPolygonEdges(p1, boundary);
    const d2 = minDistanceToPolygonEdges(p2, boundary);

    return d1 < tolerance && d2 < tolerance;
}

/**
 * Calculate minimum distance from a point to any edge of a polygon.
 */
function minDistanceToPolygonEdges(point: Point2D, polygon: Point2D[]): number {
    let minDist = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];
        const d = pointToSegmentDistance(point, p1, p2);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

/**
 * Distance from a point to a line segment.
 */
function pointToSegmentDistance(point: Point2D, segStart: Point2D, segEnd: Point2D): number {
    const dx = segEnd.x - segStart.x;
    const dz = segEnd.z - segStart.z;
    const len2 = dx * dx + dz * dz;

    if (len2 === 0) return distance(point, segStart);

    // Project point onto line, clamped to segment
    const t = Math.max(0, Math.min(1,
        ((point.x - segStart.x) * dx + (point.z - segStart.z) * dz) / len2
    ));

    const proj: Point2D = {
        x: segStart.x + t * dx,
        z: segStart.z + t * dz
    };

    return distance(point, proj);
}

/**
 * Calculate the centroid of a polygon.
 */
function polygonCentroid(polygon: Point2D[]): Point2D {
    if (polygon.length === 0) return { x: 0, z: 0 };

    let sumX = 0;
    let sumZ = 0;
    for (const p of polygon) {
        sumX += p.x;
        sumZ += p.z;
    }
    return { x: sumX / polygon.length, z: sumZ / polygon.length };
}

/**
 * Find the index of the edge in the polygon that matches the given start/end points.
 */
function findMatchingEdgeIndex(polygon: Point2D[], start: Point2D, end: Point2D): number {
    const tolerance = 0.1;

    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        // Check both orientations
        if (
            (distance(p1, start) < tolerance && distance(p2, end) < tolerance) ||
            (distance(p1, end) < tolerance && distance(p2, start) < tolerance)
        ) {
            return i;
        }
    }

    return -1;
}

/**
 * Find the street edge ID for a block edge by matching against the block's edge IDs.
 */
function findStreetEdgeId(
    block: DetectedBlock,
    edgeIndex: number,
    _edges: Map<string, GraphEdge>
): string {
    if (edgeIndex >= 0 && edgeIndex < block.edgeIds.length) {
        return block.edgeIds[edgeIndex];
    }
    return "";
}

// ============ Geometry Utilities ============

function computePolygonArea(polygon: Point2D[]): number {
    if (polygon.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i].x * polygon[j].z;
        area -= polygon[j].x * polygon[i].z;
    }
    return Math.abs(area / 2);
}

function edgeLength(edge: [Point2D, Point2D]): number {
    return distance(edge[0], edge[1]);
}

function distance(a: Point2D, b: Point2D): number {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return Math.sqrt(dx * dx + dz * dz);
}
