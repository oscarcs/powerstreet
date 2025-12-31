/**
 * Lot Subdivision Algorithm
 *
 * Subdivides strips into individual lots using perpendicular splitting rays.
 * Based on the approach from Vanegas et al. (2012).
 *
 * Pipeline:
 * 1. Generate splitting rays perpendicular to street frontage
 * 2. Slice strip with each ray to create lot polygons
 * 3. Track adjacency between polygons for potential merging
 * 4. Validate lots (min area, street frontage)
 * 5. Merge invalid lots with neighbors
 */

import { Point2D } from "./BlockDetection";
import { Strip } from "./StripGeneration";
import { slicePolygon, unionPolygons } from "./PolygonUtils";

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
    streetEdgeId: string;
    frontageLength: number;
}

interface PolygonNode {
    id: string;
    polygon: Point2D[];
    adjacentIds: Set<string>;
    isValid: boolean;
    hasRay: boolean; // True if this polygon was created by a ray split
}

/**
 * Subdivide a strip into lots using perpendicular rays.
 *
 * @param strip The strip to subdivide
 * @param rules Subdivision rules
 * @returns Array of generated lots
 */
export function subdivideStrip(strip: Strip, rules: SubdivisionRules): GeneratedLot[] {
    if (strip.polygon.length < 3 || strip.area < rules.minLotArea) {
        // Strip is too small, return as single lot
        return [
            {
                id: `${strip.id}_lot_0`,
                polygon: strip.polygon,
                area: strip.area,
                streetEdgeId: strip.streetEdgeId,
                frontageLength: edgeLength(strip.streetEdgeSegment),
            },
        ];
    }

    // Step 1: Generate splitting rays
    const rays = generateSplittingRays(strip, rules);

    if (rays.length === 0) {
        // No rays needed, return strip as single lot
        return [
            {
                id: `${strip.id}_lot_0`,
                polygon: strip.polygon,
                area: strip.area,
                streetEdgeId: strip.streetEdgeId,
                frontageLength: edgeLength(strip.streetEdgeSegment),
            },
        ];
    }

    // Step 2: Split strip with rays and track adjacency
    const nodes = splitWithRays(strip, rays);

    // Step 3: Validate and mark invalid polygons
    for (const node of nodes.values()) {
        node.isValid = validatePolygon(node.polygon, strip.streetEdgeSegment, rules);
    }

    // Step 4: Merge invalid polygons with neighbors
    const mergedNodes = mergeInvalidPolygons(nodes, rules);

    // Step 5: Convert to lots
    const lots: GeneratedLot[] = [];
    let lotIndex = 0;

    for (const node of mergedNodes.values()) {
        if (node.polygon.length < 3) continue;

        const area = computePolygonArea(node.polygon);
        if (area < 1) continue; // Skip degenerate polygons

        // Calculate frontage length
        const frontage = calculateFrontageLength(node.polygon, strip.streetEdgeSegment);

        lots.push({
            id: `${strip.id}_lot_${lotIndex++}`,
            polygon: node.polygon,
            area,
            streetEdgeId: strip.streetEdgeId,
            frontageLength: frontage,
        });
    }

    return lots;
}

/**
 * Generate perpendicular splitting rays along the street frontage.
 */
function generateSplittingRays(
    strip: Strip,
    rules: SubdivisionRules
): Array<[Point2D, Point2D]> {
    const [frontStart, frontEnd] = strip.streetEdgeSegment;
    const frontageLength = edgeLength(strip.streetEdgeSegment);

    // Calculate number of lots
    const numLots = Math.max(1, Math.round(frontageLength / rules.targetLotWidth));
    const actualLotWidth = frontageLength / numLots;

    // If we only need one lot, no rays needed
    if (numLots <= 1 || actualLotWidth < rules.minLotFrontage) {
        return [];
    }

    // Direction along frontage
    const frontDir = normalize({
        x: frontEnd.x - frontStart.x,
        z: frontEnd.z - frontStart.z,
    });

    // Perpendicular direction (into the strip)
    // Check which perpendicular direction points into the strip
    const perpDir = getInwardPerpendicular(frontDir, strip.polygon, frontStart, frontEnd);

    // Generate rays at lot boundaries
    const rays: Array<[Point2D, Point2D]> = [];
    const maxRayLength = calculateMaxRayLength(strip.polygon);

    for (let i = 1; i < numLots; i++) {
        const t = i / numLots;

        // Add slight randomization (±10% of lot width)
        const jitter = (Math.random() - 0.5) * 0.2 * actualLotWidth;
        const adjustedT = Math.max(0.05, Math.min(0.95, t + jitter / frontageLength));

        // Point on frontage
        const rayStart: Point2D = {
            x: frontStart.x + frontDir.x * frontageLength * adjustedT,
            z: frontStart.z + frontDir.z * frontageLength * adjustedT,
        };

        // Extend ray into the strip
        const rayEnd: Point2D = {
            x: rayStart.x + perpDir.x * maxRayLength,
            z: rayStart.z + perpDir.z * maxRayLength,
        };

        // Extend slightly beyond start as well (to ensure clean cut)
        const extendedStart: Point2D = {
            x: rayStart.x - perpDir.x * 1,
            z: rayStart.z - perpDir.z * 1,
        };

        rays.push([extendedStart, rayEnd]);
    }

    return rays;
}

/**
 * Split a strip polygon with multiple rays, tracking adjacency.
 */
function splitWithRays(
    strip: Strip,
    rays: Array<[Point2D, Point2D]>
): Map<string, PolygonNode> {
    const nodes = new Map<string, PolygonNode>();
    let nodeCounter = 0;

    // Start with the strip as a single polygon
    let currentPolygons: Point2D[][] = [strip.polygon];

    // Apply each ray
    for (const ray of rays) {
        const newPolygons: Point2D[][] = [];

        for (const polygon of currentPolygons) {
            const sliceResult = slicePolygon(polygon, ray[0], ray[1]);
            newPolygons.push(...sliceResult);
        }

        currentPolygons = newPolygons;
    }

    // Convert to nodes
    for (const polygon of currentPolygons) {
        if (polygon.length < 3) continue;

        const id = `node_${nodeCounter++}`;
        nodes.set(id, {
            id,
            polygon,
            adjacentIds: new Set(),
            isValid: false,
            hasRay: true,
        });
    }

    // Build adjacency graph
    const nodeArray = Array.from(nodes.values());
    for (let i = 0; i < nodeArray.length; i++) {
        for (let j = i + 1; j < nodeArray.length; j++) {
            const sharedLength = calculateSharedEdgeLength(
                nodeArray[i].polygon,
                nodeArray[j].polygon
            );
            if (sharedLength > 0.5) {
                nodeArray[i].adjacentIds.add(nodeArray[j].id);
                nodeArray[j].adjacentIds.add(nodeArray[i].id);
            }
        }
    }

    return nodes;
}

/**
 * Validate a polygon based on area and street frontage.
 */
function validatePolygon(
    polygon: Point2D[],
    streetEdge: [Point2D, Point2D],
    rules: SubdivisionRules
): boolean {
    const area = computePolygonArea(polygon);
    if (area < rules.minLotArea) return false;

    const frontage = calculateFrontageLength(polygon, streetEdge);
    if (frontage < rules.minLotFrontage) return false;

    return true;
}

/**
 * Calculate the frontage length (portion of polygon that touches street edge).
 */
function calculateFrontageLength(polygon: Point2D[], streetEdge: [Point2D, Point2D]): number {
    const tolerance = 1.0; // Distance tolerance for edge matching
    let totalFrontage = 0;

    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        // Check if both endpoints are close to the street edge line
        const d1 = pointToLineDistance(p1, streetEdge[0], streetEdge[1]);
        const d2 = pointToLineDistance(p2, streetEdge[0], streetEdge[1]);

        if (d1 < tolerance && d2 < tolerance) {
            // This edge is along the street frontage
            totalFrontage += edgeLength([p1, p2]);
        }
    }

    return totalFrontage;
}

/**
 * Merge invalid polygons with their neighbors.
 */
function mergeInvalidPolygons(
    nodes: Map<string, PolygonNode>,
    rules: SubdivisionRules,
    maxIterations: number = 10
): Map<string, PolygonNode> {
    let iteration = 0;

    while (iteration < maxIterations) {
        iteration++;
        let merged = false;

        // Find an invalid node
        for (const node of nodes.values()) {
            if (node.isValid) continue;

            // Find the best neighbor to merge with
            let bestNeighborId: string | null = null;
            let bestSharedLength = 0;

            for (const neighborId of node.adjacentIds) {
                const neighbor = nodes.get(neighborId);
                if (!neighbor) continue;

                const sharedLength = calculateSharedEdgeLength(node.polygon, neighbor.polygon);
                if (sharedLength > bestSharedLength) {
                    bestSharedLength = sharedLength;
                    bestNeighborId = neighborId;
                }
            }

            if (!bestNeighborId) continue;

            const neighbor = nodes.get(bestNeighborId)!;

            // Merge the two polygons
            const mergedPolygon = unionPolygons(node.polygon, neighbor.polygon);
            if (!mergedPolygon || mergedPolygon.length < 3) continue;

            // Update neighbor with merged polygon
            neighbor.polygon = mergedPolygon;
            neighbor.isValid = validatePolygon(
                mergedPolygon,
                [
                    { x: 0, z: 0 },
                    { x: 1, z: 0 },
                ], // Placeholder - ideally pass street edge
                rules
            );

            // Transfer adjacency
            for (const adjId of node.adjacentIds) {
                if (adjId !== bestNeighborId) {
                    neighbor.adjacentIds.add(adjId);
                    const adjNode = nodes.get(adjId);
                    if (adjNode) {
                        adjNode.adjacentIds.delete(node.id);
                        adjNode.adjacentIds.add(bestNeighborId);
                    }
                }
            }

            // Remove the merged node
            nodes.delete(node.id);
            merged = true;
            break;
        }

        if (!merged) break;
    }

    return nodes;
}

/**
 * Calculate the length of shared edge between two polygons.
 */
function calculateSharedEdgeLength(poly1: Point2D[], poly2: Point2D[]): number {
    const tolerance = 0.5;
    let totalShared = 0;

    for (let i = 0; i < poly1.length; i++) {
        const a1 = poly1[i];
        const a2 = poly1[(i + 1) % poly1.length];

        for (let j = 0; j < poly2.length; j++) {
            const b1 = poly2[j];
            const b2 = poly2[(j + 1) % poly2.length];

            // Check if edges overlap
            const overlap = calculateEdgeOverlap(a1, a2, b1, b2, tolerance);
            totalShared += overlap;
        }
    }

    return totalShared;
}

/**
 * Calculate the overlap length between two edges.
 */
function calculateEdgeOverlap(
    a1: Point2D,
    a2: Point2D,
    b1: Point2D,
    b2: Point2D,
    tolerance: number
): number {
    // Check if edges are approximately collinear
    const d1 = pointToLineDistance(b1, a1, a2);
    const d2 = pointToLineDistance(b2, a1, a2);

    if (d1 > tolerance || d2 > tolerance) {
        return 0;
    }

    // Project onto line direction
    const dir = normalize({ x: a2.x - a1.x, z: a2.z - a1.z });
    const lenA = edgeLength([a1, a2]);
    if (lenA < 0.01) return 0;

    const projB1 = dot(dir, { x: b1.x - a1.x, z: b1.z - a1.z });
    const projB2 = dot(dir, { x: b2.x - a1.x, z: b2.z - a1.z });

    const minB = Math.min(projB1, projB2);
    const maxB = Math.max(projB1, projB2);

    const overlapStart = Math.max(0, minB);
    const overlapEnd = Math.min(lenA, maxB);

    return Math.max(0, overlapEnd - overlapStart);
}

// ============ Geometry Utilities ============

function getInwardPerpendicular(
    frontDir: Point2D,
    polygon: Point2D[],
    frontStart: Point2D,
    frontEnd: Point2D
): Point2D {
    // Two perpendicular options
    const perp1 = { x: -frontDir.z, z: frontDir.x };
    const perp2 = { x: frontDir.z, z: -frontDir.x };

    // Test point along frontage midpoint
    const mid = midpoint(frontStart, frontEnd);

    const testPoint = { x: mid.x + perp1.x * 0.1, z: mid.z + perp1.z * 0.1 };

    // Return the perpendicular that points into the polygon
    return pointInPolygon(testPoint, polygon) ? perp1 : perp2;
}

function calculateMaxRayLength(polygon: Point2D[]): number {
    // Calculate polygon extent
    let minX = Infinity,
        maxX = -Infinity;
    let minZ = Infinity,
        maxZ = -Infinity;

    for (const p of polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
    }

    return Math.sqrt((maxX - minX) ** 2 + (maxZ - minZ) ** 2) * 1.5;
}

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

function dot(a: Point2D, b: Point2D): number {
    return a.x * b.x + a.z * b.z;
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

function pointToLineDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
    const dx = lineEnd.x - lineStart.x;
    const dz = lineEnd.z - lineStart.z;
    const len = Math.sqrt(dx * dx + dz * dz);

    if (len === 0) return distance(point, lineStart);

    const t = Math.max(
        0,
        Math.min(1, ((point.x - lineStart.x) * dx + (point.z - lineStart.z) * dz) / (len * len))
    );

    const projection = {
        x: lineStart.x + t * dx,
        z: lineStart.z + t * dz,
    };

    return distance(point, projection);
}
