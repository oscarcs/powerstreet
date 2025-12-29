/**
 * TransportGraphUtils - Graph operations for transport networks.
 *
 * Currently implemented for streets, but designed to be extended to other
 * transport modes (rail, pedestrian paths, etc.) which share the same
 * topology operations (snapping, splitting, intersection detection).
 */

import { WorldsyncStore } from "../../shared/WorldsyncStore";

export interface Point2D {
    x: number;
    z: number;
}

export interface SnapResult {
    type: "node" | "edge" | "none";
    nodeId?: string;
    edgeId?: string;
    position: Point2D;
    distance: number;
}

export interface CrossingResult {
    crosses: boolean;
    crossingEdgeIds: string[];
}

export interface PointToSegmentResult {
    distance: number;
    closestPoint: Point2D;
    t: number; // Parameter along segment (0 = start, 1 = end)
}

/**
 * Configuration for a transport graph layer.
 * Different transport modes can have different table names but share operations.
 */
export interface TransportLayerConfig {
    nodeTable: "streetNodes"; // Will be union type when more transport modes added
    edgeTable: "streetEdges";
}

/** Default config for street network */
export const STREET_LAYER_CONFIG: TransportLayerConfig = {
    nodeTable: "streetNodes",
    edgeTable: "streetEdges",
};

export class TransportGraphUtils {
    private store: WorldsyncStore;

    constructor(store: WorldsyncStore, _config: TransportLayerConfig = STREET_LAYER_CONFIG) {
        this.store = store;
        // Config stored for future extension to other transport modes
    }

    /**
     * Find the nearest snap target (node or edge) within threshold distance.
     * Nodes take priority over edges when both are within threshold.
     */
    findSnapTarget(x: number, z: number, threshold: number): SnapResult {
        // First check for nearby nodes
        const nodeResult = this.findNearestNode(x, z, threshold);
        if (nodeResult.type === "node") {
            return nodeResult;
        }

        // Then check for nearby edges
        const edgeResult = this.findNearestEdge(x, z, threshold);
        if (edgeResult.type === "edge") {
            return edgeResult;
        }

        return {
            type: "none",
            position: { x, z },
            distance: Infinity,
        };
    }

    /**
     * Find the nearest node within threshold distance.
     */
    findNearestNode(x: number, z: number, threshold: number): SnapResult {
        const nodeIds = this.store.getRowIds("streetNodes");
        let nearestId: string | null = null;
        let nearestDist = threshold;
        let nearestPos: Point2D = { x, z };

        for (const nodeId of nodeIds) {
            const node = this.store.getRow("streetNodes", nodeId);
            if (!node || node.x === undefined || node.z === undefined) continue;

            const nx = node.x as number;
            const nz = node.z as number;
            const dist = Math.hypot(nx - x, nz - z);

            if (dist < nearestDist) {
                nearestDist = dist;
                nearestId = nodeId;
                nearestPos = { x: nx, z: nz };
            }
        }

        if (nearestId !== null) {
            return {
                type: "node",
                nodeId: nearestId,
                position: nearestPos,
                distance: nearestDist,
            };
        }

        return {
            type: "none",
            position: { x, z },
            distance: Infinity,
        };
    }

    /**
     * Find the nearest edge within threshold distance.
     * Returns the closest point on the edge.
     */
    findNearestEdge(x: number, z: number, threshold: number): SnapResult {
        const edgeIds = this.store.getRowIds("streetEdges");
        let nearestId: string | null = null;
        let nearestDist = threshold;
        let nearestPos: Point2D = { x, z };

        for (const edgeId of edgeIds) {
            const edge = this.store.getRow("streetEdges", edgeId);
            if (!edge || !edge.startNodeId || !edge.endNodeId) continue;

            const startNodeId = edge.startNodeId as string;
            const endNodeId = edge.endNodeId as string;

            const startNode = this.store.getRow("streetNodes", startNodeId);
            const endNode = this.store.getRow("streetNodes", endNodeId);

            if (!startNode || !endNode) continue;
            if (startNode.x === undefined || startNode.z === undefined) continue;
            if (endNode.x === undefined || endNode.z === undefined) continue;

            const x1 = startNode.x as number;
            const z1 = startNode.z as number;
            const x2 = endNode.x as number;
            const z2 = endNode.z as number;

            const result = this.pointToSegmentDistance(x, z, x1, z1, x2, z2);

            // Only consider points that are actually ON the segment (not at endpoints)
            // Endpoints are handled by node snapping
            if (result.t > 0.01 && result.t < 0.99 && result.distance < nearestDist) {
                nearestDist = result.distance;
                nearestId = edgeId;
                nearestPos = result.closestPoint;
            }
        }

        if (nearestId !== null) {
            return {
                type: "edge",
                edgeId: nearestId,
                position: nearestPos,
                distance: nearestDist,
            };
        }

        return {
            type: "none",
            position: { x, z },
            distance: Infinity,
        };
    }

    /**
     * Check if a new edge from startNodeId to (endX, endZ) would cross any existing edges.
     * Excludes edges that share the start node (those are valid connections).
     */
    wouldCrossExistingEdge(startNodeId: string, endX: number, endZ: number): CrossingResult {
        const startNode = this.store.getRow("streetNodes", startNodeId);
        if (!startNode || startNode.x === undefined || startNode.z === undefined) {
            return { crosses: false, crossingEdgeIds: [] };
        }

        const startX = startNode.x as number;
        const startZ = startNode.z as number;

        const crossingEdgeIds: string[] = [];
        const edgeIds = this.store.getRowIds("streetEdges");

        for (const edgeId of edgeIds) {
            const edge = this.store.getRow("streetEdges", edgeId);
            if (!edge || !edge.startNodeId || !edge.endNodeId) continue;

            const edgeStartId = edge.startNodeId as string;
            const edgeEndId = edge.endNodeId as string;

            // Skip edges that share the start node
            if (edgeStartId === startNodeId || edgeEndId === startNodeId) {
                continue;
            }

            const edgeStartNode = this.store.getRow("streetNodes", edgeStartId);
            const edgeEndNode = this.store.getRow("streetNodes", edgeEndId);

            if (!edgeStartNode || !edgeEndNode) continue;
            if (edgeStartNode.x === undefined || edgeStartNode.z === undefined) continue;
            if (edgeEndNode.x === undefined || edgeEndNode.z === undefined) continue;

            const ex1 = edgeStartNode.x as number;
            const ez1 = edgeStartNode.z as number;
            const ex2 = edgeEndNode.x as number;
            const ez2 = edgeEndNode.z as number;

            if (this.segmentsIntersect(startX, startZ, endX, endZ, ex1, ez1, ex2, ez2)) {
                crossingEdgeIds.push(edgeId);
            }
        }

        return {
            crosses: crossingEdgeIds.length > 0,
            crossingEdgeIds,
        };
    }

    /**
     * Split an edge at a given point, creating a new node and two new edges.
     * Returns the ID of the newly created node.
     */
    splitEdge(edgeId: string, x: number, z: number): string | null {
        const edge = this.store.getRow("streetEdges", edgeId);
        if (!edge || !edge.startNodeId || !edge.endNodeId) return null;

        const startNodeId = edge.startNodeId as string;
        const endNodeId = edge.endNodeId as string;

        // Create new node at split point
        const newNodeId = this.store.addRow("streetNodes", {
            x,
            z,
        });

        if (!newNodeId) return null;

        // Copy edge properties (excluding start/end node IDs)
        const width = edge.width as number | undefined;
        const streetGroupId = edge.streetGroupId as string | undefined;
        const roadType = edge.roadType as string | undefined;
        const speedLimit = edge.speedLimit as number | undefined;
        const lanes = edge.lanes as number | undefined;
        const oneWay = edge.oneWay as boolean | undefined;

        // Create first half: original start -> new node
        this.store.addRow("streetEdges", {
            startNodeId: startNodeId,
            endNodeId: newNodeId,
            ...(width !== undefined && { width }),
            ...(streetGroupId !== undefined && { streetGroupId }),
            ...(roadType !== undefined && { roadType }),
            ...(speedLimit !== undefined && { speedLimit }),
            ...(lanes !== undefined && { lanes }),
            ...(oneWay !== undefined && { oneWay }),
        });

        // Create second half: new node -> original end
        this.store.addRow("streetEdges", {
            startNodeId: newNodeId,
            endNodeId: endNodeId,
            ...(width !== undefined && { width }),
            ...(streetGroupId !== undefined && { streetGroupId }),
            ...(roadType !== undefined && { roadType }),
            ...(speedLimit !== undefined && { speedLimit }),
            ...(lanes !== undefined && { lanes }),
            ...(oneWay !== undefined && { oneWay }),
        });

        // Delete original edge
        this.store.delRow("streetEdges", edgeId);

        return newNodeId;
    }

    /**
     * Calculate the distance from a point to a line segment.
     * Also returns the closest point on the segment and the parameter t.
     */
    pointToSegmentDistance(
        px: number,
        pz: number,
        x1: number,
        z1: number,
        x2: number,
        z2: number
    ): PointToSegmentResult {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const lengthSq = dx * dx + dz * dz;

        if (lengthSq === 0) {
            // Segment is a point
            const dist = Math.hypot(px - x1, pz - z1);
            return {
                distance: dist,
                closestPoint: { x: x1, z: z1 },
                t: 0,
            };
        }

        // Project point onto line, clamped to segment
        let t = ((px - x1) * dx + (pz - z1) * dz) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        const closestX = x1 + t * dx;
        const closestZ = z1 + t * dz;
        const distance = Math.hypot(px - closestX, pz - closestZ);

        return {
            distance,
            closestPoint: { x: closestX, z: closestZ },
            t,
        };
    }

    /**
     * Test if two line segments intersect (excluding endpoints).
     * Uses the cross product method.
     */
    segmentsIntersect(
        a1x: number,
        a1z: number,
        a2x: number,
        a2z: number,
        b1x: number,
        b1z: number,
        b2x: number,
        b2z: number
    ): boolean {
        // Direction vectors
        const dax = a2x - a1x;
        const daz = a2z - a1z;
        const dbx = b2x - b1x;
        const dbz = b2z - b1z;

        // Cross product of directions
        const cross = dax * dbz - daz * dbx;

        // Parallel lines (including collinear)
        if (Math.abs(cross) < 1e-10) {
            return false;
        }

        // Vector from a1 to b1
        const dx = b1x - a1x;
        const dz = b1z - a1z;

        // Parameters for intersection point
        const t = (dx * dbz - dz * dbx) / cross;
        const u = (dx * daz - dz * dax) / cross;

        // Check if intersection is strictly inside both segments (not at endpoints)
        // Using small epsilon to avoid floating point issues at endpoints
        const eps = 0.001;
        return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
    }

    /**
     * Get the position of a node by ID.
     */
    getNodePosition(nodeId: string): Point2D | null {
        const node = this.store.getRow("streetNodes", nodeId);
        if (!node || node.x === undefined || node.z === undefined) return null;
        return {
            x: node.x as number,
            z: node.z as number,
        };
    }

    /**
     * Get all edges connected to a node.
     */
    getConnectedEdges(nodeId: string): string[] {
        const edgeIds = this.store.getRowIds("streetEdges");
        const connected: string[] = [];

        for (const edgeId of edgeIds) {
            const edge = this.store.getRow("streetEdges", edgeId);
            if (!edge) continue;
            if (edge.startNodeId === nodeId || edge.endNodeId === nodeId) {
                connected.push(edgeId);
            }
        }

        return connected;
    }
}
