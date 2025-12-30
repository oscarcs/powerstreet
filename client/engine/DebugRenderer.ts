/**
 * DebugRenderer - Visualizes spatial structures for debugging.
 *
 * Renders:
 * - Tile boundaries from TileManager
 * - Detected blocks from street graph
 * - Subdivided lots within blocks
 */

import * as THREE from "three";
import { TileManager } from "../spatial/TileManager";
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
import {
    subdivideBlock,
    GeneratedLot,
    DEFAULT_SUBDIVISION_RULES,
} from "../../shared/procgen/LotSubdivision";

export interface DebugRenderOptions {
    showTiles: boolean;
    showBlocks: boolean;
    showOffsetBlocks: boolean; // Show blocks offset by street width (buildable area)
    showLots: boolean;
    tileColor: number;
    blockColor: number;
    offsetBlockColor: number;
    lotColor: number;
    lineHeight: number; // Y offset for debug lines
}

const DEFAULT_OPTIONS: DebugRenderOptions = {
    showTiles: true,
    showBlocks: true,
    showOffsetBlocks: true,
    showLots: true,
    tileColor: 0x00ff00, // Green for tiles
    blockColor: 0xff00ff, // Magenta for blocks (centerline)
    offsetBlockColor: 0x00ffff, // Cyan for offset blocks (buildable area)
    lotColor: 0xffff00, // Yellow for lots
    lineHeight: 0.5,
};

export class DebugRenderer {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private tileManager: TileManager;
    private options: DebugRenderOptions;

    private debugGroup: THREE.Group;
    private tileLines: THREE.LineSegments | null = null;
    private blockLines: THREE.LineSegments | null = null;
    private offsetBlockLines: THREE.LineSegments | null = null;
    private lotLines: THREE.LineSegments | null = null;

    private isVisible = false;
    private detectedBlocks: DetectedBlock[] = [];
    private offsetBlockPolygons: (Point2D[] | null)[] = [];
    private edges: Map<string, GraphEdge> = new Map();
    private generatedLots: GeneratedLot[] = [];

    private rebuildTimeout: ReturnType<typeof setTimeout> | null = null;
    private static readonly REBUILD_DEBOUNCE_MS = 300;

    constructor(
        scene: THREE.Scene,
        store: WorldsyncStore,
        tileManager: TileManager,
        options: Partial<DebugRenderOptions> = {}
    ) {
        this.scene = scene;
        this.store = store;
        this.tileManager = tileManager;
        this.options = { ...DEFAULT_OPTIONS, ...options };

        this.debugGroup = new THREE.Group();
        this.debugGroup.name = "DebugRenderer";
        this.debugGroup.visible = false;

        // Listen for street graph changes to trigger rebuild
        this.setupStoreListeners();
    }

    /**
     * Set up listeners for street graph changes.
     */
    private setupStoreListeners(): void {
        // Listen for node/edge additions, deletions, and updates
        this.store.addRowListener("streetNodes", null, () => this.scheduleRebuild());
        this.store.addRowListener("streetEdges", null, () => this.scheduleRebuild());
        this.store.addCellListener("streetNodes", null, null, () => this.scheduleRebuild());
        this.store.addCellListener("streetEdges", null, null, () => this.scheduleRebuild());
    }

    /**
     * Schedule a debounced rebuild (only if visible).
     */
    private scheduleRebuild(): void {
        if (!this.isVisible || !this.debugGroup.visible) return;

        // Debounce rebuilds to avoid excessive recalculation during rapid edits
        if (this.rebuildTimeout) {
            clearTimeout(this.rebuildTimeout);
        }
        this.rebuildTimeout = setTimeout(() => {
            this.rebuildTimeout = null;
            this.rebuild();
        }, DebugRenderer.REBUILD_DEBOUNCE_MS);
    }

    /**
     * Show debug visualization.
     */
    show(): void {
        if (!this.isVisible) {
            this.scene.add(this.debugGroup);
            this.isVisible = true;
        }
        this.debugGroup.visible = true;
        this.rebuild();
    }

    /**
     * Hide debug visualization.
     */
    hide(): void {
        this.debugGroup.visible = false;
    }

    /**
     * Toggle debug visualization.
     */
    toggle(): boolean {
        if (this.debugGroup.visible) {
            this.hide();
        } else {
            this.show();
        }
        return this.debugGroup.visible;
    }

    /**
     * Check if debug visualization is visible.
     */
    get visible(): boolean {
        return this.debugGroup.visible;
    }

    /**
     * Update options.
     */
    setOptions(options: Partial<DebugRenderOptions>): void {
        this.options = { ...this.options, ...options };
        if (this.isVisible) {
            this.rebuild();
        }
    }

    /**
     * Rebuild all debug visualizations.
     */
    rebuild(): void {
        this.clearDebugObjects();

        if (this.options.showTiles) {
            this.buildTileVisualization();
        }

        if (this.options.showBlocks || this.options.showOffsetBlocks || this.options.showLots) {
            this.detectAndSubdivide();
        }

        if (this.options.showBlocks) {
            this.buildBlockVisualization();
        }

        if (this.options.showOffsetBlocks) {
            this.buildOffsetBlockVisualization();
        }

        if (this.options.showLots) {
            this.buildLotVisualization();
        }
    }

    /**
     * Get detected blocks (for external use).
     */
    getDetectedBlocks(): DetectedBlock[] {
        return this.detectedBlocks;
    }

    /**
     * Get generated lots (for external use).
     */
    getGeneratedLots(): GeneratedLot[] {
        return this.generatedLots;
    }

    private clearDebugObjects(): void {
        if (this.tileLines) {
            this.debugGroup.remove(this.tileLines);
            this.tileLines.geometry.dispose();
            (this.tileLines.material as THREE.Material).dispose();
            this.tileLines = null;
        }
        if (this.blockLines) {
            this.debugGroup.remove(this.blockLines);
            this.blockLines.geometry.dispose();
            (this.blockLines.material as THREE.Material).dispose();
            this.blockLines = null;
        }
        if (this.offsetBlockLines) {
            this.debugGroup.remove(this.offsetBlockLines);
            this.offsetBlockLines.geometry.dispose();
            (this.offsetBlockLines.material as THREE.Material).dispose();
            this.offsetBlockLines = null;
        }
        if (this.lotLines) {
            this.debugGroup.remove(this.lotLines);
            this.lotLines.geometry.dispose();
            (this.lotLines.material as THREE.Material).dispose();
            this.lotLines = null;
        }
    }

    private buildTileVisualization(): void {
        const tiles = this.tileManager.getAllTiles();
        if (tiles.length === 0) return;

        const positions: number[] = [];
        const y = this.options.lineHeight;

        for (const tile of tiles) {
            const { minX, minZ, maxX, maxZ } = tile.bounds;

            // Four edges of the tile
            // Bottom edge
            positions.push(minX, y, minZ, maxX, y, minZ);
            // Right edge
            positions.push(maxX, y, minZ, maxX, y, maxZ);
            // Top edge
            positions.push(maxX, y, maxZ, minX, y, maxZ);
            // Left edge
            positions.push(minX, y, maxZ, minX, y, minZ);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: this.options.tileColor,
            linewidth: 2,
        });

        this.tileLines = new THREE.LineSegments(geometry, material);
        this.tileLines.name = "TileDebug";
        this.debugGroup.add(this.tileLines);
    }

    private detectAndSubdivide(): void {
        // Build graph from store
        const nodes = new Map<string, GraphNode>();
        this.edges = new Map<string, GraphEdge>();

        // Get all street nodes
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

        // Get all street edges (including width)
        const edgeIds = this.store.getRowIds("streetEdges");
        for (const edgeId of edgeIds) {
            const row = this.store.getRow("streetEdges", edgeId);
            if (row.startNodeId && row.endNodeId) {
                this.edges.set(edgeId, {
                    id: edgeId,
                    startNodeId: row.startNodeId as string,
                    endNodeId: row.endNodeId as string,
                    width: (row.width as number) || 10, // Default 10 units
                });
            }
        }

        // Detect blocks
        const allBlocks = detectBlocks(nodes, this.edges);
        this.detectedBlocks = getInteriorBlocks(allBlocks);

        console.log(`DebugRenderer: Detected ${this.detectedBlocks.length} interior blocks`);

        // Compute offset polygons for each block
        this.offsetBlockPolygons = this.detectedBlocks.map(block => {
            const offsetPoly = offsetBlockBoundary(block, this.edges);
            return offsetPoly;
        });

        const validOffsets = this.offsetBlockPolygons.filter(p => p !== null).length;
        console.log(`DebugRenderer: ${validOffsets}/${this.detectedBlocks.length} blocks have valid offset polygons`);

        // Subdivide blocks into lots (using offset polygons when available)
        this.generatedLots = [];
        for (let i = 0; i < this.detectedBlocks.length; i++) {
            const block = this.detectedBlocks[i];
            const offsetPoly = this.offsetBlockPolygons[i];

            // Use offset polygon if available, otherwise fall back to centerline
            const blockForSubdivision: DetectedBlock = offsetPoly
                ? { ...block, polygon: offsetPoly }
                : block;

            const lots = subdivideBlock(blockForSubdivision, DEFAULT_SUBDIVISION_RULES);
            this.generatedLots.push(...lots);
        }

        console.log(`DebugRenderer: Generated ${this.generatedLots.length} lots`);
    }

    private buildBlockVisualization(): void {
        if (this.detectedBlocks.length === 0) return;

        const positions: number[] = [];
        const y = this.options.lineHeight + 0.1; // Slightly above tiles

        for (const block of this.detectedBlocks) {
            const polygon = block.polygon;
            for (let i = 0; i < polygon.length; i++) {
                const current = polygon[i];
                const next = polygon[(i + 1) % polygon.length];
                positions.push(current.x, y, current.z, next.x, y, next.z);
            }
        }

        if (positions.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: this.options.blockColor,
            linewidth: 2,
        });

        this.blockLines = new THREE.LineSegments(geometry, material);
        this.blockLines.name = "BlockDebug";
        this.debugGroup.add(this.blockLines);
    }

    private buildOffsetBlockVisualization(): void {
        if (this.offsetBlockPolygons.length === 0) return;

        const positions: number[] = [];
        const y = this.options.lineHeight + 0.15; // Between blocks and lots

        for (const polygon of this.offsetBlockPolygons) {
            if (!polygon) continue; // Skip degenerate blocks

            for (let i = 0; i < polygon.length; i++) {
                const current = polygon[i];
                const next = polygon[(i + 1) % polygon.length];
                positions.push(current.x, y, current.z, next.x, y, next.z);
            }
        }

        if (positions.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: this.options.offsetBlockColor,
            linewidth: 2,
        });

        this.offsetBlockLines = new THREE.LineSegments(geometry, material);
        this.offsetBlockLines.name = "OffsetBlockDebug";
        this.debugGroup.add(this.offsetBlockLines);
    }

    private buildLotVisualization(): void {
        if (this.generatedLots.length === 0) return;

        const positions: number[] = [];
        const y = this.options.lineHeight + 0.2; // Above blocks

        for (const lot of this.generatedLots) {
            const polygon = lot.polygon;
            for (let i = 0; i < polygon.length; i++) {
                const current = polygon[i];
                const next = polygon[(i + 1) % polygon.length];
                positions.push(current.x, y, current.z, next.x, y, next.z);
            }
        }

        if (positions.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: this.options.lotColor,
            linewidth: 2,
        });

        this.lotLines = new THREE.LineSegments(geometry, material);
        this.lotLines.name = "LotDebug";
        this.debugGroup.add(this.lotLines);
    }

    /**
     * Dispose of all resources.
     */
    dispose(): void {
        if (this.rebuildTimeout) {
            clearTimeout(this.rebuildTimeout);
            this.rebuildTimeout = null;
        }
        this.clearDebugObjects();
        this.scene.remove(this.debugGroup);
    }
}
