/**
 * Polygon validation utilities for checking self-intersection.
 */

type Point2D = [number, number];

/**
 * Check if two line segments intersect (excluding shared endpoints).
 * Uses the cross product method to determine intersection.
 */
function segmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
    const d1 = direction(p3, p4, p1);
    const d2 = direction(p3, p4, p2);
    const d3 = direction(p1, p2, p3);
    const d4 = direction(p1, p2, p4);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }

    // Check collinear cases
    if (d1 === 0 && onSegment(p3, p4, p1)) return true;
    if (d2 === 0 && onSegment(p3, p4, p2)) return true;
    if (d3 === 0 && onSegment(p1, p2, p3)) return true;
    if (d4 === 0 && onSegment(p1, p2, p4)) return true;

    return false;
}

/**
 * Calculate the cross product direction.
 */
function direction(pi: Point2D, pj: Point2D, pk: Point2D): number {
    return (pk[0] - pi[0]) * (pj[1] - pi[1]) - (pj[0] - pi[0]) * (pk[1] - pi[1]);
}

/**
 * Check if point pk lies on segment pi-pj (assuming collinearity).
 */
function onSegment(pi: Point2D, pj: Point2D, pk: Point2D): boolean {
    return (
        Math.min(pi[0], pj[0]) <= pk[0] &&
        pk[0] <= Math.max(pi[0], pj[0]) &&
        Math.min(pi[1], pj[1]) <= pk[1] &&
        pk[1] <= Math.max(pi[1], pj[1])
    );
}

/**
 * Check if two points are the same (within a small epsilon).
 */
function pointsEqual(p1: Point2D, p2: Point2D, epsilon: number = 1e-10): boolean {
    return Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon;
}

/**
 * Check if a polygon is self-intersecting.
 * A polygon is self-intersecting if any non-adjacent edges cross each other.
 *
 * @param polygon - Array of 2D points representing the polygon vertices (not closed, i.e., first != last)
 * @returns true if the polygon self-intersects, false otherwise
 */
export function isPolygonSelfIntersecting(polygon: Point2D[]): boolean {
    const n = polygon.length;

    if (n < 3) {
        return false; // Not a valid polygon
    }

    // Check every pair of edges
    for (let i = 0; i < n; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % n];

        for (let j = i + 2; j < n; j++) {
            // Skip adjacent edges (they share a vertex)
            if (i === 0 && j === n - 1) continue;

            const p3 = polygon[j];
            const p4 = polygon[(j + 1) % n];

            // Skip if edges share a vertex
            if (
                pointsEqual(p1, p3) ||
                pointsEqual(p1, p4) ||
                pointsEqual(p2, p3) ||
                pointsEqual(p2, p4)
            ) {
                continue;
            }

            if (segmentsIntersect(p1, p2, p3, p4)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Check if a polygon has valid winding (non-zero area).
 *
 * @param polygon - Array of 2D points representing the polygon vertices
 * @returns true if the polygon has valid winding
 */
export function hasValidWinding(polygon: Point2D[]): boolean {
    const area = calculateSignedArea(polygon);
    return Math.abs(area) > 1e-10;
}

/**
 * Calculate the signed area of a polygon.
 * Positive for counter-clockwise, negative for clockwise.
 */
export function calculateSignedArea(polygon: Point2D[]): number {
    const n = polygon.length;
    let area = 0;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += polygon[i][0] * polygon[j][1];
        area -= polygon[j][0] * polygon[i][1];
    }

    return area / 2;
}
