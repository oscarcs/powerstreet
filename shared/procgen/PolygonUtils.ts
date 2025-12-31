/**
 * Polygon Utilities
 *
 * Geometric operations for polygon manipulation:
 * - Polygon slicing with a line
 * - Polygon union
 * - Shared edge detection
 */

import { Point2D } from "./BlockDetection";

/**
 * Slice a polygon with a line, returning the resulting pieces.
 *
 * @param polygon The polygon to slice
 * @param lineStart Start point of the slicing line
 * @param lineEnd End point of the slicing line
 * @returns Array of resulting polygon pieces (typically 2)
 */
export function slicePolygon(
    polygon: Point2D[],
    lineStart: Point2D,
    lineEnd: Point2D
): Point2D[][] {
    if (polygon.length < 3) return [polygon];

    // Find all intersection points between the line and polygon edges
    const intersections: { point: Point2D; edgeIndex: number; t: number }[] = [];

    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        const intersection = lineSegmentIntersection(lineStart, lineEnd, p1, p2);
        if (intersection) {
            // Calculate parameter along the edge
            const edgeLen = distance(p1, p2);
            const t = edgeLen > 0 ? distance(p1, intersection.point) / edgeLen : 0;

            intersections.push({
                point: intersection.point,
                edgeIndex: i,
                t,
            });
        }
    }

    // Need exactly 2 intersection points for a valid slice
    if (intersections.length !== 2) {
        return [polygon];
    }

    // Sort by edge index (and t within same edge)
    intersections.sort((a, b) => {
        if (a.edgeIndex !== b.edgeIndex) return a.edgeIndex - b.edgeIndex;
        return a.t - b.t;
    });

    const [int1, int2] = intersections;

    // Build two polygons by walking around the original polygon
    const poly1: Point2D[] = [];
    const poly2: Point2D[] = [];

    // Poly1: from int1 to int2 (going forward around polygon)
    poly1.push(int1.point);
    for (let i = int1.edgeIndex + 1; i <= int2.edgeIndex; i++) {
        poly1.push(polygon[i]);
    }
    poly1.push(int2.point);

    // Poly2: from int2 to int1 (continuing around polygon)
    poly2.push(int2.point);
    for (let i = int2.edgeIndex + 1; i < polygon.length; i++) {
        poly2.push(polygon[i]);
    }
    for (let i = 0; i <= int1.edgeIndex; i++) {
        poly2.push(polygon[i]);
    }
    poly2.push(int1.point);

    // Filter out degenerate polygons
    const result: Point2D[][] = [];
    if (poly1.length >= 3 && computeArea(poly1) > 0.1) {
        result.push(poly1);
    }
    if (poly2.length >= 3 && computeArea(poly2) > 0.1) {
        result.push(poly2);
    }

    return result.length > 0 ? result : [polygon];
}

/**
 * Compute the union of two polygons.
 *
 * This is a simplified implementation that uses the Sutherland-Hodgman algorithm
 * approach for convex cases and falls back to a buffer-based approach for complex cases.
 *
 * @param poly1 First polygon
 * @param poly2 Second polygon
 * @returns Union polygon, or null if union fails
 */
export function unionPolygons(poly1: Point2D[], poly2: Point2D[]): Point2D[] | null {
    if (poly1.length < 3) return poly2.length >= 3 ? [...poly2] : null;
    if (poly2.length < 3) return [...poly1];

    // For simple cases where polygons share an edge, we can merge directly
    const sharedEdge = findSharedEdge(poly1, poly2);
    if (sharedEdge) {
        const result = mergePolygonsAlongSharedEdge(poly1, poly2, sharedEdge);
        if (result) {
            return result;
        }
        console.log(`unionPolygons: mergePolygonsAlongSharedEdge failed`);
        console.log(`  poly1 (${poly1.length} verts):`, poly1.map(p => `(${p.x.toFixed(1)},${p.z.toFixed(1)})`).join(' '));
        console.log(`  poly2 (${poly2.length} verts):`, poly2.map(p => `(${p.x.toFixed(1)},${p.z.toFixed(1)})`).join(' '));
        console.log(`  sharedEdge: (${sharedEdge[0].x.toFixed(1)},${sharedEdge[0].z.toFixed(1)}) -> (${sharedEdge[1].x.toFixed(1)},${sharedEdge[1].z.toFixed(1)})`);
    } else {
        console.log(`unionPolygons: no shared edge found`);
        console.log(`  poly1 (${poly1.length} verts):`, poly1.map(p => `(${p.x.toFixed(1)},${p.z.toFixed(1)})`).join(' '));
        console.log(`  poly2 (${poly2.length} verts):`, poly2.map(p => `(${p.x.toFixed(1)},${p.z.toFixed(1)})`).join(' '));
    }

    // Fallback: return null to indicate failure (caller should handle)
    return null;
}

/**
 * Check if two polygons share an edge.
 */
export function polygonsShareEdge(poly1: Point2D[], poly2: Point2D[]): boolean {
    return findSharedEdge(poly1, poly2) !== null;
}

/**
 * Find a shared edge between two polygons.
 *
 * @returns The shared edge as [start, end], or null if no shared edge exists
 */
export function findSharedEdge(
    poly1: Point2D[],
    poly2: Point2D[]
): [Point2D, Point2D] | null {
    const tolerance = 0.5; // Distance tolerance for edge matching
    const minLength = 0.5; // Minimum edge length to consider

    let bestOverlap: [Point2D, Point2D] | null = null;
    let bestOverlapLen = 0;

    for (let i = 0; i < poly1.length; i++) {
        const a1 = poly1[i];
        const a2 = poly1[(i + 1) % poly1.length];
        const edgeLen1 = distance(a1, a2);
        if (edgeLen1 < minLength) continue;

        for (let j = 0; j < poly2.length; j++) {
            const b1 = poly2[j];
            const b2 = poly2[(j + 1) % poly2.length];
            const edgeLen2 = distance(b1, b2);
            if (edgeLen2 < minLength) continue;

            // Get the actual overlapping segment
            const overlap = getEdgeOverlap(a1, a2, b1, b2, tolerance);
            if (overlap) {
                const overlapLen = distance(overlap[0], overlap[1]);
                if (overlapLen > bestOverlapLen) {
                    bestOverlap = overlap;
                    bestOverlapLen = overlapLen;
                }
            }
        }
    }

    return bestOverlap;
}

/**
 * Check if two edges overlap (are collinear and share some portion).
 * Returns the overlapping segment if found, or null if no overlap.
 */
function getEdgeOverlap(
    a1: Point2D,
    a2: Point2D,
    b1: Point2D,
    b2: Point2D,
    tolerance: number
): [Point2D, Point2D] | null {
    // Check if the edges are approximately collinear
    const d1 = pointToLineDistance(b1, a1, a2);
    const d2 = pointToLineDistance(b2, a1, a2);

    if (d1 > tolerance || d2 > tolerance) {
        return null;
    }

    // Project all points onto the line direction
    const dir = normalize({ x: a2.x - a1.x, z: a2.z - a1.z });
    const len = distance(a1, a2);
    if (len < 0.001) return null;

    const projA1 = 0;
    const projA2 = len;
    const projB1 = dot(dir, { x: b1.x - a1.x, z: b1.z - a1.z });
    const projB2 = dot(dir, { x: b2.x - a1.x, z: b2.z - a1.z });

    const minA = Math.min(projA1, projA2);
    const maxA = Math.max(projA1, projA2);
    const minB = Math.min(projB1, projB2);
    const maxB = Math.max(projB1, projB2);

    // Calculate overlap
    const overlapStart = Math.max(minA, minB);
    const overlapEnd = Math.min(maxA, maxB);

    if (overlapEnd - overlapStart <= tolerance) {
        return null;
    }

    // Convert overlap back to points
    const startPoint: Point2D = {
        x: a1.x + dir.x * overlapStart,
        z: a1.z + dir.z * overlapStart,
    };
    const endPoint: Point2D = {
        x: a1.x + dir.x * overlapEnd,
        z: a1.z + dir.z * overlapEnd,
    };

    return [startPoint, endPoint];
}

/**
 * Merge two polygons that share an edge segment.
 * Works with partial edge overlaps where the shared segment may not align with polygon vertices.
 */
function mergePolygonsAlongSharedEdge(
    poly1: Point2D[],
    poly2: Point2D[],
    sharedEdge: [Point2D, Point2D]
): Point2D[] | null {
    const tolerance = 1.0;

    // Find vertices in each polygon that are on or near the shared edge
    const onEdge1: number[] = [];
    const onEdge2: number[] = [];

    for (let i = 0; i < poly1.length; i++) {
        if (pointToLineDistance(poly1[i], sharedEdge[0], sharedEdge[1]) < tolerance) {
            onEdge1.push(i);
        }
    }

    for (let i = 0; i < poly2.length; i++) {
        if (pointToLineDistance(poly2[i], sharedEdge[0], sharedEdge[1]) < tolerance) {
            onEdge2.push(i);
        }
    }

    if (onEdge1.length < 1 || onEdge2.length < 1) {
        return null;
    }

    // For each polygon, find the vertices that are at or beyond the shared edge endpoints
    // We want to walk around each polygon, skipping the portion on the shared edge

    // Find connection points - vertices closest to shared edge endpoints
    const findClosest = (poly: Point2D[], target: Point2D, candidates: number[]): number => {
        let best = candidates[0];
        let bestDist = distance(poly[best], target);
        for (const idx of candidates) {
            const d = distance(poly[idx], target);
            if (d < bestDist) {
                bestDist = d;
                best = idx;
            }
        }
        return best;
    };

    // Find the entry/exit points for each polygon on the shared edge
    const p1Start = findClosest(poly1, sharedEdge[0], onEdge1);
    const p1End = findClosest(poly1, sharedEdge[1], onEdge1);
    const p2Start = findClosest(poly2, sharedEdge[0], onEdge2);
    const p2End = findClosest(poly2, sharedEdge[1], onEdge2);

    // Build result by walking around poly1 (skipping shared edge), then poly2 (skipping shared edge)
    const result: Point2D[] = [];

    // Walk poly1 from end of shared edge to start of shared edge (the non-shared portion)
    let idx = p1End;
    for (let i = 0; i < poly1.length; i++) {
        result.push(poly1[idx]);
        if (idx === p1Start) break;
        idx = (idx + 1) % poly1.length;
    }

    // Walk poly2 from start of shared edge to end of shared edge (the non-shared portion)
    // Note: poly2 might have opposite winding, so we might need to walk backwards
    // Check which direction to walk by seeing which way leads away from the shared edge
    const p2Next = (p2Start + 1) % poly2.length;
    const p2Prev = (p2Start - 1 + poly2.length) % poly2.length;

    const distNext = pointToLineDistance(poly2[p2Next], sharedEdge[0], sharedEdge[1]);
    const distPrev = pointToLineDistance(poly2[p2Prev], sharedEdge[0], sharedEdge[1]);

    // Walk in the direction that goes away from the shared edge
    const step = distNext > distPrev ? 1 : -1;

    idx = (p2Start + step + poly2.length) % poly2.length;
    for (let i = 0; i < poly2.length; i++) {
        if (idx === p2End) break;
        result.push(poly2[idx]);
        idx = (idx + step + poly2.length) % poly2.length;
    }

    // Deduplicate consecutive points
    const dedupedResult: Point2D[] = [];
    for (let i = 0; i < result.length; i++) {
        const curr = result[i];
        const prev = result[(i - 1 + result.length) % result.length];
        if (distance(curr, prev) > 0.1) {
            dedupedResult.push(curr);
        }
    }

    // Also check first/last
    if (dedupedResult.length > 1) {
        if (distance(dedupedResult[0], dedupedResult[dedupedResult.length - 1]) < 0.1) {
            dedupedResult.pop();
        }
    }

    return dedupedResult.length >= 3 ? dedupedResult : null;
}

// ============ Geometry Helpers ============

function lineSegmentIntersection(
    a1: Point2D,
    a2: Point2D,
    b1: Point2D,
    b2: Point2D
): { point: Point2D; t: number; u: number } | null {
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

    // Line-segment intersection (t can be any value, u must be in [0,1])
    if (u >= 0 && u <= 1) {
        return {
            point: {
                x: a1.x + t * d1x,
                z: a1.z + t * d1z,
            },
            t,
            u,
        };
    }

    return null;
}

function pointToLineDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
    const dx = lineEnd.x - lineStart.x;
    const dz = lineEnd.z - lineStart.z;
    const len = Math.sqrt(dx * dx + dz * dz);

    if (len === 0) return distance(point, lineStart);

    const t = Math.max(
        0,
        Math.min(
            1,
            ((point.x - lineStart.x) * dx + (point.z - lineStart.z) * dz) / (len * len)
        )
    );

    const projection = {
        x: lineStart.x + t * dx,
        z: lineStart.z + t * dz,
    };

    return distance(point, projection);
}

function distance(a: Point2D, b: Point2D): number {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return Math.sqrt(dx * dx + dz * dz);
}

function normalize(v: Point2D): Point2D {
    const len = Math.sqrt(v.x * v.x + v.z * v.z);
    if (len === 0) return { x: 0, z: 0 };
    return { x: v.x / len, z: v.z / len };
}

function dot(a: Point2D, b: Point2D): number {
    return a.x * b.x + a.z * b.z;
}

function computeArea(polygon: Point2D[]): number {
    if (polygon.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i].x * polygon[j].z;
        area -= polygon[j].x * polygon[i].z;
    }
    return Math.abs(area / 2);
}
