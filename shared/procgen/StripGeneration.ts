/**
 * Strip Generation Algorithm
 *
 * Generates strips from city blocks using the straight skeleton algorithm.
 * Based on the approach from Vanegas et al. (2012).
 *
 * Pipeline:
 * 1. Alpha Strips: Generate skeleton faces, each associated with one input edge
 * 2. Beta Strips: Transfer corner regions between adjacent strips for cleaner geometry
 */

import { StraightSkeletonBuilder, Vector2d, List } from "straight-skeleton-geojson";
import { DetectedBlock, Point2D, GraphEdge } from "./BlockDetection";
import { slicePolygon, unionPolygons, findSharedEdge } from "./PolygonUtils";

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

interface AdjacentPair {
    strip1Id: string;
    strip2Id: string;
    sharedEdge: [Point2D, Point2D];
}

/**
 * Generate strips for a block using the straight skeleton algorithm.
 *
 * @param block The detected block
 * @param offsetPolygon The block polygon offset inward by street widths
 * @param edges Map of edge ID to edge data
 * @returns Array of strips
 */
export function generateStrips(
    block: DetectedBlock,
    offsetPolygon: Point2D[],
    edges: Map<string, GraphEdge>
): Strip[] {
    if (offsetPolygon.length < 3) {
        return [];
    }

    // Step 1: Generate alpha strips using straight skeleton
    const alphaStrips = generateAlphaStrips(block, offsetPolygon, edges);

    if (alphaStrips.length === 0) {
        return [];
    }

    // Step 2: Find adjacent pairs
    const adjacentPairs = findAdjacentPairs(alphaStrips, offsetPolygon);

    // Step 3: Compute beta strips (transfer corner regions)
    const betaStrips = computeBetaStrips(alphaStrips, adjacentPairs);

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

/**
 * Generate alpha strips by computing the straight skeleton and associating
 * each face with its corresponding input edge.
 */
function generateAlphaStrips(
    block: DetectedBlock,
    offsetPolygon: Point2D[],
    edges: Map<string, GraphEdge>
): AlphaStrip[] {
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
        console.warn(`StripGeneration: Skeleton computation failed for block ${block.id}:`, err);
        return [];
    }

    // Get skeleton faces (each corresponds to one input edge)
    const skeletonEdges = skeleton.edges;
    const strips: AlphaStrip[] = [];

    console.log(`StripGeneration: Block ${block.id} has ${offsetPolygon.length} vertices, skeleton produced ${skeletonEdges.length} faces`);

    for (let i = 0; i < skeletonEdges.length; i++) {
        const edgeResult = skeletonEdges[i];
        const facePolygon = edgeResult.polygon;

        if (!facePolygon || facePolygon.length < 3) {
            console.log(`  Face ${i}: skipped (length=${facePolygon?.length ?? 0})`);
            continue;
        }

        console.log(`  Face ${i}: ${facePolygon.length} vertices`);

        // Convert back to Point2D
        const polygon: Point2D[] = [];
        for (let j = 0; j < facePolygon.length; j++) {
            const v = facePolygon[j];
            polygon.push({ x: v.x, z: v.y });
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

    return strips;
}

/**
 * Find pairs of strips that share an edge (are adjacent).
 */
function findAdjacentPairs(strips: AlphaStrip[], _blockPolygon: Point2D[]): AdjacentPair[] {
    const pairs: AdjacentPair[] = [];

    console.log(`findAdjacentPairs: Checking ${strips.length} strips for adjacency`);

    for (let i = 0; i < strips.length; i++) {
        for (let j = i + 1; j < strips.length; j++) {
            const strip1 = strips[i];
            const strip2 = strips[j];

            // Check if these strips share an edge
            const sharedEdge = findSharedEdge(strip1.polygon, strip2.polygon);
            if (sharedEdge) {
                console.log(`  Found adjacent pair: ${strip1.id} <-> ${strip2.id}`);
                pairs.push({
                    strip1Id: strip1.id,
                    strip2Id: strip2.id,
                    sharedEdge,
                });
            }
        }
    }

    console.log(`findAdjacentPairs: Found ${pairs.length} adjacent pairs`);
    return pairs;
}

/**
 * Compute beta strips by transferring corner regions between adjacent strips.
 * The shorter street's corner region is transferred to the longer street.
 */
function computeBetaStrips(
    alphaStrips: AlphaStrip[],
    adjacentPairs: AdjacentPair[]
): AlphaStrip[] {
    console.log(`computeBetaStrips: Processing ${adjacentPairs.length} adjacent pairs`);

    // Create a mutable map of strips
    const stripMap = new Map<string, AlphaStrip>();
    for (const strip of alphaStrips) {
        stripMap.set(strip.id, { ...strip, polygon: [...strip.polygon] });
    }

    // Process each adjacent pair
    for (const pair of adjacentPairs) {
        const strip1 = stripMap.get(pair.strip1Id);
        const strip2 = stripMap.get(pair.strip2Id);

        if (!strip1 || !strip2) {
            console.log(`  Pair ${pair.strip1Id} <-> ${pair.strip2Id}: strips not found`);
            continue;
        }

        // Determine which strip has the shorter street edge
        const len1 = edgeLength(strip1.streetEdgeSegment);
        const len2 = edgeLength(strip2.streetEdgeSegment);

        console.log(`  Pair ${pair.strip1Id} (len=${len1.toFixed(1)}, idx=${strip1.edgeIndex}) <-> ${pair.strip2Id} (len=${len2.toFixed(1)}, idx=${strip2.edgeIndex})`);

        // Determine source (gives up corner) and dest (receives corner)
        // Primary: shorter edge gives to longer edge
        // Tiebreaker: higher edge index gives to lower edge index (for consistent pattern)
        let sourceStrip: AlphaStrip;
        let destStrip: AlphaStrip;

        if (Math.abs(len1 - len2) >= 1) {
            // Different lengths: shorter gives to longer
            [sourceStrip, destStrip] = len1 < len2 ? [strip1, strip2] : [strip2, strip1];
        } else {
            // Similar lengths: use edge index as tiebreaker
            // Higher index gives to lower index (creates consistent corner pattern)
            [sourceStrip, destStrip] = strip1.edgeIndex > strip2.edgeIndex ? [strip1, strip2] : [strip2, strip1];
        }

        console.log(`    Source: ${sourceStrip.id}, Dest: ${destStrip.id}`);

        // Calculate the slicing line for the corner region
        const slicingLine = calculateSlicingLine(
            sourceStrip.polygon,
            pair.sharedEdge,
            destStrip.polygon
        );

        if (!slicingLine) {
            console.log(`    Failed: no slicing line calculated`);
            continue;
        }

        console.log(`    Slicing line: (${slicingLine[0].x.toFixed(1)},${slicingLine[0].z.toFixed(1)}) -> (${slicingLine[1].x.toFixed(1)},${slicingLine[1].z.toFixed(1)})`);

        // Slice the source strip
        const sliceResult = slicePolygon(sourceStrip.polygon, slicingLine[0], slicingLine[1]);

        if (sliceResult.length !== 2) {
            console.log(`    Failed: slice produced ${sliceResult.length} pieces (expected 2)`);
            continue;
        }

        // Determine which piece is the transfer region (the one containing the shared edge midpoint)
        const sharedMid = midpoint(pair.sharedEdge[0], pair.sharedEdge[1]);
        const transferIdx = pointInPolygon(sharedMid, sliceResult[0]) ? 0 : 1;
        const remainIdx = 1 - transferIdx;

        const transferRegion = sliceResult[transferIdx];
        const remainingRegion = sliceResult[remainIdx];

        console.log(`    Transfer region: ${transferRegion.length} verts, Remaining: ${remainingRegion.length} verts`);

        // Update source strip with remaining region
        sourceStrip.polygon = remainingRegion;

        // Union transfer region with destination strip
        const unionResult = unionPolygons(destStrip.polygon, transferRegion);
        if (unionResult) {
            console.log(`    Union successful: ${unionResult.length} verts`);
            destStrip.polygon = unionResult;
        } else {
            console.log(`    Union failed`);
        }
    }

    // Filter out empty strips and return
    const result = Array.from(stripMap.values()).filter(
        (strip) => strip.polygon.length >= 3 && computePolygonArea(strip.polygon) > 1
    );
    console.log(`computeBetaStrips: Returning ${result.length} beta strips`);
    return result;
}

/**
 * Calculate a slicing line from the shared edge into the source polygon.
 */
function calculateSlicingLine(
    sourcePolygon: Point2D[],
    sharedEdge: [Point2D, Point2D],
    _destPolygon: Point2D[]
): [Point2D, Point2D] | null {
    // Start point: midpoint of shared edge
    const start = midpoint(sharedEdge[0], sharedEdge[1]);

    // Direction: perpendicular to shared edge, pointing into source polygon
    const edgeDir = normalize({
        x: sharedEdge[1].x - sharedEdge[0].x,
        z: sharedEdge[1].z - sharedEdge[0].z,
    });
    const perpDir = { x: -edgeDir.z, z: edgeDir.x };

    // Check which direction points into source polygon
    const testPoint = { x: start.x + perpDir.x * 0.1, z: start.z + perpDir.z * 0.1 };

    const inSource = pointInPolygon(testPoint, sourcePolygon);
    const dir = inSource ? perpDir : { x: -perpDir.x, z: -perpDir.z };

    // Find intersection with opposite edge of source polygon
    const maxDist = 1000; // Maximum ray distance
    const end = { x: start.x + dir.x * maxDist, z: start.z + dir.z * maxDist };

    // Find where ray exits the polygon
    let closestIntersection: Point2D | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < sourcePolygon.length; i++) {
        const p1 = sourcePolygon[i];
        const p2 = sourcePolygon[(i + 1) % sourcePolygon.length];

        // Skip the shared edge itself
        if (isEdgeMatch(p1, p2, sharedEdge[0], sharedEdge[1])) continue;

        const intersection = lineSegmentIntersection(start, end, p1, p2);
        if (intersection) {
            const dist = distance(start, intersection);
            if (dist > 0.01 && dist < closestDist) {
                closestDist = dist;
                closestIntersection = intersection;
            }
        }
    }

    if (!closestIntersection) return null;

    // Extend slightly beyond the intersection
    return [
        { x: start.x - dir.x * 0.1, z: start.z - dir.z * 0.1 },
        { x: closestIntersection.x + dir.x * 0.1, z: closestIntersection.z + dir.z * 0.1 },
    ];
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

function midpoint(a: Point2D, b: Point2D): Point2D {
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function normalize(v: Point2D): Point2D {
    const len = Math.sqrt(v.x * v.x + v.z * v.z);
    if (len === 0) return { x: 0, z: 0 };
    return { x: v.x / len, z: v.z / len };
}

function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x,
            zi = polygon[i].z;
        const xj = polygon[j].x,
            zj = polygon[j].z;

        if (zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function isEdgeMatch(p1: Point2D, p2: Point2D, e1: Point2D, e2: Point2D): boolean {
    const tolerance = 0.1;
    return (
        (distance(p1, e1) < tolerance && distance(p2, e2) < tolerance) ||
        (distance(p1, e2) < tolerance && distance(p2, e1) < tolerance)
    );
}

function lineSegmentIntersection(
    a1: Point2D,
    a2: Point2D,
    b1: Point2D,
    b2: Point2D
): Point2D | null {
    const d1x = a2.x - a1.x;
    const d1z = a2.z - a1.z;
    const d2x = b2.x - b1.x;
    const d2z = b2.z - b1.z;

    const cross = d1x * d2z - d1z * d2x;
    if (Math.abs(cross) < 1e-10) return null;

    const dx = b1.x - a1.x;
    const dz = b1.z - a1.z;

    const t = (dx * d2z - dz * d2x) / cross;
    const u = (dx * d1z - dz * d1x) / cross;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
            x: a1.x + t * d1x,
            z: a1.z + t * d1z,
        };
    }

    return null;
}
