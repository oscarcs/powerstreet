/**
 * Polygon Utilities
 *
 * Geometric operations for polygon manipulation:
 * - Polygon slicing with a line
 * - Polygon union
 * - Shared edge detection
 */

import * as turf from "@turf/turf";
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
    lineEnd: Point2D,
    debug: boolean = false
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

    // Deduplicate intersections at polygon vertices
    // When a line passes through a vertex, it intersects both adjacent edges at t=0 and t=1
    const deduped: typeof intersections = [];
    const VERTEX_TOLERANCE = 0.01;

    for (const int of intersections) {
        let isDuplicate = false;
        for (const existing of deduped) {
            if (distance(int.point, existing.point) < VERTEX_TOLERANCE) {
                isDuplicate = true;
                break;
            }
        }
        if (!isDuplicate) {
            deduped.push(int);
        }
    }

    // Need exactly 2 intersection points for a valid slice
    if (deduped.length !== 2) {
        if (debug) {
            console.log(`    slicePolygon: Found ${intersections.length} intersections, ${deduped.length} after dedup (need 2)`);
            console.log(`      Line: (${lineStart.x.toFixed(2)}, ${lineStart.z.toFixed(2)}) -> (${lineEnd.x.toFixed(2)}, ${lineEnd.z.toFixed(2)})`);
            console.log(`      Polygon (${polygon.length} vertices):`);
            for (let i = 0; i < polygon.length; i++) {
                const p = polygon[i];
                console.log(`        ${i}: (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
            }
            if (intersections.length > 0) {
                console.log(`      Intersections found:`);
                for (const int of intersections) {
                    console.log(`        edge ${int.edgeIndex} at t=${int.t.toFixed(3)}: (${int.point.x.toFixed(2)}, ${int.point.z.toFixed(2)})`);
                }
            }
        }
        return [polygon];
    }

    // Sort by edge index (and t within same edge)
    deduped.sort((a, b) => {
        if (a.edgeIndex !== b.edgeIndex) return a.edgeIndex - b.edgeIndex;
        return a.t - b.t;
    });

    const [int1, int2] = deduped;

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

    // Deduplicate vertices in each polygon (can happen when intersection points coincide with vertices)
    const deduplicatePolygon = (poly: Point2D[]): Point2D[] => {
        const result: Point2D[] = [];
        for (const p of poly) {
            if (result.length === 0 || distance(p, result[result.length - 1]) > 0.01) {
                result.push(p);
            }
        }
        // Also check first vs last
        if (result.length > 1 && distance(result[0], result[result.length - 1]) < 0.01) {
            result.pop();
        }
        return result;
    };

    const cleanPoly1 = deduplicatePolygon(poly1);
    const cleanPoly2 = deduplicatePolygon(poly2);

    // Filter out degenerate polygons
    const result: Point2D[][] = [];
    if (cleanPoly1.length >= 3 && computeArea(cleanPoly1) > 0.1) {
        result.push(cleanPoly1);
    }
    if (cleanPoly2.length >= 3 && computeArea(cleanPoly2) > 0.1) {
        result.push(cleanPoly2);
    }

    return result.length > 0 ? result : [polygon];
}

/**
 * Compute the union of two polygons using Turf.js.
 *
 * @param poly1 First polygon
 * @param poly2 Second polygon
 * @returns Union polygon, or null if union fails
 */
export function unionPolygons(poly1: Point2D[], poly2: Point2D[]): Point2D[] | null {
    if (poly1.length < 3) return poly2.length >= 3 ? [...poly2] : null;
    if (poly2.length < 3) return [...poly1];

    try {
        // Convert to Turf polygons (closed loops)
        const toTurfCoords = (poly: Point2D[]) => {
            const coords = poly.map((p) => [p.x, p.z]);
            if (
                coords.length > 0 &&
                (coords[0][0] !== coords[coords.length - 1][0] ||
                    coords[0][1] !== coords[coords.length - 1][1])
            ) {
                coords.push(coords[0]);
            }
            return [coords];
        };

        const tPoly1 = turf.polygon(toTurfCoords(poly1));
        const tPoly2 = turf.polygon(toTurfCoords(poly2));

        const unionResult = turf.union(turf.featureCollection([tPoly1, tPoly2]));

        if (!unionResult) return null;

        const geometry = unionResult.geometry;

        // Convert back to Point2D[]
        if (geometry.type === "Polygon") {
            const coords = geometry.coordinates[0];
            // Remove closing point if present (check last vs first)
            const result = coords.map((c) => ({ x: c[0], z: c[1] }));
            if (
                result.length > 1 &&
                distance(result[0], result[result.length - 1]) < 0.001
            ) {
                result.pop();
            }
            return result;
        } else if (geometry.type === "MultiPolygon") {
            // Return the largest polygon by area
            let maxArea = -1;
            let bestPoly: Point2D[] | null = null;

            for (const polyCoords of geometry.coordinates) {
                const coords = polyCoords[0];
                const result = coords.map((c) => ({ x: c[0], z: c[1] }));
                if (
                    result.length > 1 &&
                    distance(result[0], result[result.length - 1]) < 0.001
                ) {
                    result.pop();
                }
                const area = computeArea(result);
                if (area > maxArea) {
                    maxArea = area;
                    bestPoly = result;
                }
            }
            return bestPoly;
        }
    } catch (err) {
        console.warn("unionPolygons: Turf union failed", err);
        return null;
    }

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
