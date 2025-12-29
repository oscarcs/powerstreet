/**
 * Lot Subdivision Algorithm
 *
 * Subdivides a block polygon into individual lots based on subdivision rules.
 * This is a simplified implementation that creates lots perpendicular to the
 * block's street-facing edges.
 */

import { DetectedBlock, Point2D } from "./BlockDetection";

export interface SubdivisionRules {
    minLotFrontage: number; // meters, minimum lot width along street
    maxLotFrontage: number; // meters, maximum lot width along street
    minLotArea: number; // square meters
    maxLotDepth: number; // meters, maximum lot depth from street
    targetLotWidth: number; // meters, preferred lot width
}

export const DEFAULT_SUBDIVISION_RULES: SubdivisionRules = {
    minLotFrontage: 10,
    maxLotFrontage: 50,
    minLotArea: 200,
    maxLotDepth: 40,
    targetLotWidth: 25,
};

export interface GeneratedLot {
    id: string;
    polygon: Point2D[];
    area: number;
    frontageLength: number;
    depth: number;
    frontageEdgeIndex: number; // Which edge of the block this lot faces
}

/**
 * Subdivide a block into lots.
 *
 * This simplified algorithm:
 * 1. Identifies the longest edge as the primary street frontage
 * 2. Divides the block into strips perpendicular to that edge
 * 3. Each strip becomes a lot
 *
 * @param block The detected block to subdivide
 * @param rules Subdivision rules
 * @returns Array of generated lots
 */
export function subdivideBlock(
    block: DetectedBlock,
    rules: SubdivisionRules = DEFAULT_SUBDIVISION_RULES
): GeneratedLot[] {
    const polygon = block.polygon;
    if (polygon.length < 3) return [];

    // Find the longest edge (likely the main street frontage)
    const { edgeIndex, edgeStart, edgeEnd, edgeLength } = findLongestEdge(polygon);

    // Calculate lot count based on frontage rules
    const numLots = Math.max(1, Math.floor(edgeLength / rules.targetLotWidth));
    const actualLotWidth = edgeLength / numLots;

    // Skip if lots would be too small
    if (actualLotWidth < rules.minLotFrontage) {
        // Return the entire block as one lot
        return [
            {
                id: `${block.id}_lot_0`,
                polygon: [...polygon],
                area: Math.abs(block.area),
                frontageLength: edgeLength,
                depth: calculateBlockDepth(polygon, edgeStart, edgeEnd),
                frontageEdgeIndex: edgeIndex,
            },
        ];
    }

    // Generate lots by dividing the block perpendicular to the frontage edge
    const lots: GeneratedLot[] = [];
    const edgeDir = normalize({ x: edgeEnd.x - edgeStart.x, z: edgeEnd.z - edgeStart.z });
    const perpDir = { x: -edgeDir.z, z: edgeDir.x }; // Perpendicular direction (pointing inward)

    // Determine if perpendicular direction points into the block
    const blockCenter = getPolygonCentroid(polygon);
    const testPoint = {
        x: (edgeStart.x + edgeEnd.x) / 2 + perpDir.x * 0.1,
        z: (edgeStart.z + edgeEnd.z) / 2 + perpDir.z * 0.1,
    };

    // If test point is farther from center, flip the direction
    const distToCenter = distance(testPoint, blockCenter);
    const distFromEdge = distance(
        { x: (edgeStart.x + edgeEnd.x) / 2, z: (edgeStart.z + edgeEnd.z) / 2 },
        blockCenter
    );
    if (distToCenter > distFromEdge) {
        perpDir.x = -perpDir.x;
        perpDir.z = -perpDir.z;
    }

    // Calculate depth (distance from frontage to back of block)
    const depth = Math.min(calculateBlockDepth(polygon, edgeStart, edgeEnd), rules.maxLotDepth);

    for (let i = 0; i < numLots; i++) {
        // Calculate corners of this lot
        const t0 = i / numLots;
        const t1 = (i + 1) / numLots;

        const frontLeft = {
            x: edgeStart.x + edgeDir.x * edgeLength * t0,
            z: edgeStart.z + edgeDir.z * edgeLength * t0,
        };
        const frontRight = {
            x: edgeStart.x + edgeDir.x * edgeLength * t1,
            z: edgeStart.z + edgeDir.z * edgeLength * t1,
        };
        const backLeft = {
            x: frontLeft.x + perpDir.x * depth,
            z: frontLeft.z + perpDir.z * depth,
        };
        const backRight = {
            x: frontRight.x + perpDir.x * depth,
            z: frontRight.z + perpDir.z * depth,
        };

        // Clip lot polygon to block boundary
        const lotPolygon = clipToBlock([frontLeft, frontRight, backRight, backLeft], polygon);

        if (lotPolygon.length >= 3) {
            const lotArea = Math.abs(computePolygonArea(lotPolygon));

            // Only include lots meeting minimum area
            if (lotArea >= rules.minLotArea) {
                lots.push({
                    id: `${block.id}_lot_${i}`,
                    polygon: lotPolygon,
                    area: lotArea,
                    frontageLength: actualLotWidth,
                    depth: depth,
                    frontageEdgeIndex: edgeIndex,
                });
            }
        }
    }

    return lots;
}

/**
 * Find the longest edge of a polygon.
 */
function findLongestEdge(polygon: Point2D[]): {
    edgeIndex: number;
    edgeStart: Point2D;
    edgeEnd: Point2D;
    edgeLength: number;
} {
    let maxLength = 0;
    let maxIndex = 0;

    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        const len = distance(polygon[i], polygon[j]);
        if (len > maxLength) {
            maxLength = len;
            maxIndex = i;
        }
    }

    return {
        edgeIndex: maxIndex,
        edgeStart: polygon[maxIndex],
        edgeEnd: polygon[(maxIndex + 1) % polygon.length],
        edgeLength: maxLength,
    };
}

/**
 * Calculate the depth of a block perpendicular to a given edge.
 */
function calculateBlockDepth(polygon: Point2D[], edgeStart: Point2D, edgeEnd: Point2D): number {
    const edgeDir = normalize({ x: edgeEnd.x - edgeStart.x, z: edgeEnd.z - edgeStart.z });
    const perpDir = { x: -edgeDir.z, z: edgeDir.x };

    let maxDist = 0;
    const edgeMid = { x: (edgeStart.x + edgeEnd.x) / 2, z: (edgeStart.z + edgeEnd.z) / 2 };

    for (const point of polygon) {
        const dx = point.x - edgeMid.x;
        const dz = point.z - edgeMid.z;
        const dist = Math.abs(dx * perpDir.x + dz * perpDir.z);
        if (dist > maxDist) {
            maxDist = dist;
        }
    }

    return maxDist;
}

/**
 * Clip a rectangular lot to fit within a block boundary.
 * This is a simplified clipping that returns the intersection.
 */
function clipToBlock(lot: Point2D[], block: Point2D[]): Point2D[] {
    // For simplicity, we use the Sutherland-Hodgman algorithm for convex clipping
    // This works well for typical block shapes

    let outputList = [...lot];

    for (let i = 0; i < block.length; i++) {
        if (outputList.length === 0) break;

        const inputList = [...outputList];
        outputList = [];

        const edgeStart = block[i];
        const edgeEnd = block[(i + 1) % block.length];

        for (let j = 0; j < inputList.length; j++) {
            const current = inputList[j];
            const next = inputList[(j + 1) % inputList.length];

            const currentInside = isPointLeftOfLine(current, edgeStart, edgeEnd);
            const nextInside = isPointLeftOfLine(next, edgeStart, edgeEnd);

            if (currentInside) {
                if (nextInside) {
                    outputList.push(next);
                } else {
                    const intersection = lineIntersection(current, next, edgeStart, edgeEnd);
                    if (intersection) outputList.push(intersection);
                }
            } else if (nextInside) {
                const intersection = lineIntersection(current, next, edgeStart, edgeEnd);
                if (intersection) outputList.push(intersection);
                outputList.push(next);
            }
        }
    }

    return outputList;
}

/**
 * Check if a point is on the left side of a line (for CCW polygon).
 */
function isPointLeftOfLine(point: Point2D, lineStart: Point2D, lineEnd: Point2D): boolean {
    return (
        (lineEnd.x - lineStart.x) * (point.z - lineStart.z) -
            (lineEnd.z - lineStart.z) * (point.x - lineStart.x) >=
        0
    );
}

/**
 * Find intersection point of two line segments.
 */
function lineIntersection(
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    p4: Point2D
): Point2D | null {
    const d1x = p2.x - p1.x;
    const d1z = p2.z - p1.z;
    const d2x = p4.x - p3.x;
    const d2z = p4.z - p3.z;

    const cross = d1x * d2z - d1z * d2x;
    if (Math.abs(cross) < 1e-10) return null; // Parallel lines

    const t = ((p3.x - p1.x) * d2z - (p3.z - p1.z) * d2x) / cross;

    return {
        x: p1.x + t * d1x,
        z: p1.z + t * d1z,
    };
}

/**
 * Compute signed area of a polygon.
 */
function computePolygonArea(polygon: Point2D[]): number {
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
 * Get centroid of a polygon.
 */
function getPolygonCentroid(polygon: Point2D[]): Point2D {
    let sumX = 0;
    let sumZ = 0;
    for (const p of polygon) {
        sumX += p.x;
        sumZ += p.z;
    }
    return {
        x: sumX / polygon.length,
        z: sumZ / polygon.length,
    };
}

/**
 * Calculate distance between two points.
 */
function distance(a: Point2D, b: Point2D): number {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Normalize a vector.
 */
function normalize(v: Point2D): Point2D {
    const len = Math.sqrt(v.x * v.x + v.z * v.z);
    if (len === 0) return { x: 0, z: 0 };
    return { x: v.x / len, z: v.z / len };
}
