/**
 * IntersectionGeometry - Utilities for computing multi-way intersection geometry.
 *
 * When 3+ street edges meet at a node, we need to:
 * 1. Compute the intersection polygon (filled center area)
 * 2. Determine where each arm's geometry should end
 */

import { Vec2 } from "./ExtrudePolyline";

export interface IntersectionArm {
    edgeId: string;
    otherNodeId: string;
    angle: number;        // Angle from center to other node (radians)
    width: number;        // Street width
    direction: Vec2;      // Unit vector from center toward other node
}

export interface IntersectionData {
    nodeId: string;
    center: Vec2;
    arms: IntersectionArm[];      // Sorted CCW by angle
    polygon: Vec2[];              // Intersection boundary polygon
    armEndpoints: ArmEndpoints[]; // Left/right endpoints for each arm
}

export interface ArmEndpoints {
    left: Vec2;   // Left side of arm at intersection boundary
    right: Vec2;  // Right side of arm at intersection boundary
}

export interface NodeData {
    id: string;
    x: number;
    z: number;
}

export interface EdgeData {
    id: string;
    startNodeId: string;
    endNodeId: string;
    width: number;
}

/**
 * Compute intersection geometry for a node with 3+ connected edges.
 */
export function computeIntersection(
    nodeId: string,
    center: Vec2,
    connectedEdges: EdgeData[],
    nodes: Map<string, NodeData>
): IntersectionData | null {
    if (connectedEdges.length < 3) {
        return null; // Not a multi-way intersection
    }

    // Build arm data with angles
    const arms: IntersectionArm[] = [];

    for (const edge of connectedEdges) {
        const otherNodeId = edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId;
        const otherNode = nodes.get(otherNodeId);
        if (!otherNode) continue;

        const dx = otherNode.x - center[0];
        const dz = otherNode.z - center[1];
        const len = Math.sqrt(dx * dx + dz * dz);

        if (len < 0.001) continue; // Skip degenerate edges

        const direction: Vec2 = [dx / len, dz / len];
        const angle = Math.atan2(dz, dx);

        arms.push({
            edgeId: edge.id,
            otherNodeId,
            angle,
            width: edge.width || 10,
            direction,
        });
    }

    if (arms.length < 3) {
        return null;
    }

    // Sort arms by angle (counter-clockwise)
    arms.sort((a, b) => a.angle - b.angle);

    // Compute intersection polygon and arm endpoints
    const polygon: Vec2[] = [];
    // Store geometric info to map back to arms. 
    // For arm[i]:
    //   rightEndpoint comes from transition i -> i+1
    //   leftEndpoint comes from transition i-1 -> i
    const armRightEndpoints: Vec2[] = new Array(arms.length);
    const armLeftEndpoints: Vec2[] = new Array(arms.length);

    for (let i = 0; i < arms.length; i++) {
        const arm = arms[i];
        const nextIdx = (i + 1) % arms.length;
        const nextArm = arms[nextIdx];

        // Angle difference logic (CCW)
        // arms are sorted by angle.
        // delta = next - current.
        let deltaAngle = nextArm.angle - arm.angle;
        if (deltaAngle < 0) deltaAngle += Math.PI * 2;

        // Check if this is a "straight" or reflexive side (e.g. top of a T-junction)
        // Threshold: 160 degrees (~2.8 radians)
        if (deltaAngle > 2.8) {
            let maxOtherHalfWidth = 5; // Default fallback

            // Collect other arms
            if (arms.length > 2) {
                let maxW = 0;
                for (let k = 0; k < arms.length; k++) {
                    if (k !== i && k !== nextIdx) {
                        maxW = Math.max(maxW, arms[k].width / 2);
                    }
                }
                if (maxW > 0) maxOtherHalfWidth = maxW;
            } else {
                // 2-way intersection (straight road?), use own widths
                maxOtherHalfWidth = Math.max(arm.width / 2, nextArm.width / 2);
            }

            // Compute the "start" points of the edges (near center)
            const { p1 } = computeEdgeLines(center, arm, nextArm);
            // We need p2 relative to nextArm's Left Edge. 
            // computeEdgeLines returns p1 (arm Right) and p2 (nextArm Left).
            const { p2 } = computeEdgeLines(center, arm, nextArm);

            // Project outward
            // arm.direction is "Out" from center.
            // We want endpoint to be "Out" from center by maxOtherHalfWidth
            const v1: Vec2 = [
                p1[0] + arm.direction[0] * maxOtherHalfWidth,
                p1[1] + arm.direction[1] * maxOtherHalfWidth
            ];

            const v2: Vec2 = [
                p2[0] + nextArm.direction[0] * maxOtherHalfWidth,
                p2[1] + nextArm.direction[1] * maxOtherHalfWidth
            ];

            polygon.push(v1);
            polygon.push(v2);

            armRightEndpoints[i] = v1;
            armLeftEndpoints[nextIdx] = v2;

        } else {
            // Standard Miter
            const miterPoint = computeMiterPoint(center, arm, nextArm);
            polygon.push(miterPoint);
            armRightEndpoints[i] = miterPoint;
            armLeftEndpoints[nextIdx] = miterPoint;
        }
    }

    // Compute arm endpoints (left and right boundary points for each arm)
    const finalArmEndpoints: ArmEndpoints[] = [];
    for (let i = 0; i < arms.length; i++) {
        finalArmEndpoints.push({
            left: armRightEndpoints[i],
            right: armLeftEndpoints[i],
        });
    }

    return {
        nodeId,
        center,
        arms,
        polygon,
        armEndpoints: finalArmEndpoints,
    };
}

/**
 * Helper to get the edge lines for two adjacent arms.
 * Returns points p1 (on arm1 Right Edge) and p2 (on arm2 Left Edge) close to center.
 */
function computeEdgeLines(center: Vec2, arm1: IntersectionArm, arm2: IntersectionArm): { p1: Vec2, p2: Vec2 } {
    const normal1: Vec2 = [-arm1.direction[1], arm1.direction[0]];
    const normal2: Vec2 = [-arm2.direction[1], arm2.direction[0]];
    const halfWidth1 = arm1.width / 2;
    const halfWidth2 = arm2.width / 2;

    const p1: Vec2 = [center[0] + normal1[0] * halfWidth1, center[1] + normal1[1] * halfWidth1];
    const p2: Vec2 = [center[0] - normal2[0] * halfWidth2, center[1] - normal2[1] * halfWidth2];

    return { p1, p2 };
}

/**
 * Compute the miter point where the right edge of arm1 meets the left edge of arm2.
 */
function computeMiterPoint(center: Vec2, arm1: IntersectionArm, arm2: IntersectionArm): Vec2 {
    const { p1, p2 } = computeEdgeLines(center, arm1, arm2);

    // Direction vectors
    const d1 = arm1.direction;
    const d2 = arm2.direction;

    // Find intersection of two lines: p1 + t1*d1 = p2 + t2*d2
    const cross = d1[0] * d2[1] - d1[1] * d2[0];

    if (Math.abs(cross) < 0.0001) {
        // Parallel
        return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    }

    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const t1 = (dx * d2[1] - dy * d2[0]) / cross;

    const miterPoint: Vec2 = [
        p1[0] + t1 * d1[0],
        p1[1] + t1 * d1[1],
    ];

    // Clamp
    const halfWidth1 = arm1.width / 2;
    const halfWidth2 = arm2.width / 2;
    const distFromCenter = Math.sqrt((miterPoint[0] - center[0]) ** 2 + (miterPoint[1] - center[1]) ** 2);
    const maxDist = Math.max(halfWidth1, halfWidth2) * 3;

    if (distFromCenter > maxDist) {
        const scale = maxDist / distFromCenter;
        miterPoint[0] = center[0] + (miterPoint[0] - center[0]) * scale;
        miterPoint[1] = center[1] + (miterPoint[1] - center[1]) * scale;
    }

    return miterPoint;
}

/**
 * Triangulate a convex polygon for rendering.
 * Uses fan triangulation from first vertex.
 */
export function triangulateConvexPolygon(polygon: Vec2[]): [number, number, number][] {
    if (polygon.length < 3) return [];

    const triangles: [number, number, number][] = [];
    for (let i = 1; i < polygon.length - 1; i++) {
        triangles.push([0, i, i + 1]);
    }
    return triangles;
}
