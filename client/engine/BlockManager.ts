/**
 * BlockManager - Manages block detection, strip generation, and lot subdivision.
 *
 * This manager listens to street graph changes and computes derived data:
 * 1. Detects enclosed blocks from the street network
 * 2. Generates strips using straight skeleton algorithm
 * 3. Subdivides strips into lots
 *
 * Results are cached and made available to DebugRenderer and other systems.
 */

import { WorldsyncStore } from "../../shared/WorldsyncStore";
import {
    detectBlocks,
    getInteriorBlocks,
    DetectedBlock,
    GraphNode,
    GraphEdge,
    offsetBlockBoundary,
    Point2D,
} from "../../shared/procgen/BlockDetection";
import { Strip, generateStrips } from "../../shared/procgen/StripGeneration";
import {
    GeneratedLot,
    subdivideStrip,
    SubdivisionRules,
} from "../../shared/procgen/LotSubdivision";

export interface BlockManagerOptions {
    maxLotDepth: number;
    targetLotWidth: number;
    minLotArea: number;
    minLotFrontage: number;
    maxLotFrontage: number;
    defaultStreetWidth: number;
}

const DEFAULT_OPTIONS: BlockManagerOptions = {
    maxLotDepth: 40,
    targetLotWidth: 25,
    minLotArea: 200,
    minLotFrontage: 10,
    maxLotFrontage: 50,
    defaultStreetWidth: 10,
};

export class BlockManager {
    private store: WorldsyncStore;
    private options: BlockManagerOptions;

    // Cached data
    private cachedBlocks: DetectedBlock[] = [];
    private cachedOffsetPolygons: (Point2D[] | null)[] = [];
    private cachedStrips: Strip[] = [];
    private cachedLots: GeneratedLot[] = [];
    private edges: Map<string, GraphEdge> = new Map();

    // Rebuild state
    private rebuildTimeout: ReturnType<typeof setTimeout> | null = null;
    private static readonly REBUILD_DEBOUNCE_MS = 300;

    constructor(store: WorldsyncStore, options: Partial<BlockManagerOptions> = {}) {
        this.store = store;
        this.options = { ...DEFAULT_OPTIONS, ...options };

        this.setupStoreListeners();
        // Initial rebuild
        this.scheduleRebuild();
    }

    /**
     * Set up listeners for street graph changes.
     */
    private setupStoreListeners(): void {
        this.store.addRowListener("streetNodes", null, () => this.scheduleRebuild());
        this.store.addRowListener("streetEdges", null, () => this.scheduleRebuild());
        this.store.addCellListener("streetNodes", null, null, () => this.scheduleRebuild());
        this.store.addCellListener("streetEdges", null, null, () => this.scheduleRebuild());
    }

    /**
     * Schedule a debounced rebuild.
     */
    private scheduleRebuild(): void {
        if (this.rebuildTimeout) {
            clearTimeout(this.rebuildTimeout);
        }
        this.rebuildTimeout = setTimeout(() => {
            this.rebuildTimeout = null;
            this.rebuild();
        }, BlockManager.REBUILD_DEBOUNCE_MS);
    }

    /**
     * Force an immediate rebuild.
     */
    public forceRebuild(): void {
        if (this.rebuildTimeout) {
            clearTimeout(this.rebuildTimeout);
            this.rebuildTimeout = null;
        }
        this.rebuild();
    }

    /**
     * Rebuild all derived data from the street graph.
     */
    private rebuild(): void {
        // Step 1: Build graph from store
        const nodes = new Map<string, GraphNode>();
        this.edges = new Map<string, GraphEdge>();

        const nodeIds = this.store.getRowIds("streetNodes");
        for (const nodeId of nodeIds) {
            const row = this.store.getRow("streetNodes", nodeId);
            if (row.x !== undefined && row.z !== undefined) {
                nodes.set(nodeId, {
                    id: nodeId,
                    x: row.x as number,
                    z: row.z as number,
                });
            }
        }

        const edgeIds = this.store.getRowIds("streetEdges");
        for (const edgeId of edgeIds) {
            const row = this.store.getRow("streetEdges", edgeId);
            if (row.startNodeId && row.endNodeId) {
                this.edges.set(edgeId, {
                    id: edgeId,
                    startNodeId: row.startNodeId as string,
                    endNodeId: row.endNodeId as string,
                    width: (row.width as number) || this.options.defaultStreetWidth,
                });
            }
        }

        // Step 2: Detect blocks
        const allBlocks = detectBlocks(nodes, this.edges);
        this.cachedBlocks = getInteriorBlocks(allBlocks);

        console.log(`BlockManager: Detected ${this.cachedBlocks.length} interior blocks`);

        // Step 3: Compute offset polygons (inset by street width)
        this.cachedOffsetPolygons = this.cachedBlocks.map((block) => {
            return offsetBlockBoundary(block, this.edges, this.options.defaultStreetWidth);
        });

        const validOffsets = this.cachedOffsetPolygons.filter((p) => p !== null).length;
        console.log(
            `BlockManager: ${validOffsets}/${this.cachedBlocks.length} blocks have valid offset polygons`
        );

        // Step 4: Generate strips for each block
        this.cachedStrips = [];
        for (let i = 0; i < this.cachedBlocks.length; i++) {
            const block = this.cachedBlocks[i];
            const offsetPolygon = this.cachedOffsetPolygons[i];

            if (!offsetPolygon) continue;

            try {
                const strips = generateStrips(block, offsetPolygon, this.edges);
                this.cachedStrips.push(...strips);
            } catch (err) {
                console.warn(`BlockManager: Failed to generate strips for block ${block.id}:`, err);
            }
        }

        console.log(`BlockManager: Generated ${this.cachedStrips.length} strips`);

        // Step 5: Subdivide strips into lots
        const rules: SubdivisionRules = {
            minLotFrontage: this.options.minLotFrontage,
            maxLotFrontage: this.options.maxLotFrontage,
            minLotArea: this.options.minLotArea,
            maxLotDepth: this.options.maxLotDepth,
            targetLotWidth: this.options.targetLotWidth,
        };

        this.cachedLots = [];
        for (const strip of this.cachedStrips) {
            try {
                const lots = subdivideStrip(strip, rules);
                this.cachedLots.push(...lots);
            } catch (err) {
                console.warn(`BlockManager: Failed to subdivide strip ${strip.id}:`, err);
            }
        }

        console.log(`BlockManager: Generated ${this.cachedLots.length} lots`);
    }

    /**
     * Get detected blocks (centerline polygons).
     */
    public getBlocks(): DetectedBlock[] {
        return this.cachedBlocks;
    }

    /**
     * Get offset polygons (buildable area, inset by street width).
     */
    public getOffsetPolygons(): (Point2D[] | null)[] {
        return this.cachedOffsetPolygons;
    }

    /**
     * Get generated strips.
     */
    public getStrips(): Strip[] {
        return this.cachedStrips;
    }

    /**
     * Get generated lots.
     */
    public getLots(): GeneratedLot[] {
        return this.cachedLots;
    }

    /**
     * Get edge data.
     */
    public getEdges(): Map<string, GraphEdge> {
        return this.edges;
    }

    /**
     * Update options and trigger rebuild.
     */
    public setOptions(options: Partial<BlockManagerOptions>): void {
        this.options = { ...this.options, ...options };
        this.scheduleRebuild();
    }

    /**
     * Dispose of resources.
     */
    public dispose(): void {
        if (this.rebuildTimeout) {
            clearTimeout(this.rebuildTimeout);
            this.rebuildTimeout = null;
        }
    }
}
