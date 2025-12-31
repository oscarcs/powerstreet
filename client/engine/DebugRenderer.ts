/**
 * DebugRenderer - Visualizes spatial structures for debugging.
 *
 * Renders:
 * - Tile boundaries from TileManager
 * - Detected blocks from street graph
 * - Strips from straight skeleton
 * - Subdivided lots within blocks
 */

import * as THREE from "three";
import { TileManager } from "../spatial/TileManager";
import { BlockManager } from "./BlockManager";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { DetectedBlock } from "../../shared/procgen/BlockDetection";
import { Strip } from "../../shared/procgen/StripGeneration";
import { GeneratedLot } from "../../shared/procgen/LotSubdivision";

export interface DebugRenderOptions {
    showTiles: boolean;
    showBlocks: boolean;
    showOffsetBlocks: boolean; // Show blocks offset by street width (buildable area)
    showStrips: boolean; // Show strips from straight skeleton
    showLots: boolean;
    tileColor: number;
    blockColor: number;
    offsetBlockColor: number;
    stripColor: number;
    lotColor: number;
    lineHeight: number; // Y offset for debug lines
}

const DEFAULT_OPTIONS: DebugRenderOptions = {
    showTiles: true,
    showBlocks: true,
    showOffsetBlocks: true,
    showStrips: true,
    showLots: true,
    tileColor: 0x00ff00, // Green for tiles
    blockColor: 0xff00ff, // Magenta for blocks (centerline)
    offsetBlockColor: 0x00ffff, // Cyan for offset blocks (buildable area)
    stripColor: 0xff8800, // Orange for strips
    lotColor: 0xffff00, // Yellow for lots
    lineHeight: 0.5,
};

export class DebugRenderer {
    private scene: THREE.Scene;
    private store: WorldsyncStore;
    private blockManager: BlockManager;
    private tileManager: TileManager;
    private options: DebugRenderOptions;

    private debugGroup: THREE.Group;
    private tileLines: THREE.LineSegments | null = null;
    private blockLines: THREE.LineSegments | null = null;
    private offsetBlockLines: THREE.LineSegments | null = null;
    private stripLines: THREE.LineSegments | null = null;
    private lotLines: THREE.LineSegments | null = null;

    private isVisible = false;
    private rebuildTimeout: ReturnType<typeof setTimeout> | null = null;
    private static readonly REBUILD_DEBOUNCE_MS = 300;

    constructor(
        scene: THREE.Scene,
        store: WorldsyncStore,
        blockManager: BlockManager,
        tileManager: TileManager,
        options: Partial<DebugRenderOptions> = {}
    ) {
        this.scene = scene;
        this.store = store;
        this.blockManager = blockManager;
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
        // Ensure BlockManager has latest data
        this.blockManager.forceRebuild();

        this.clearDebugObjects();

        if (this.options.showTiles) {
            this.buildTileVisualization();
        }

        if (this.options.showBlocks) {
            this.buildBlockVisualization();
        }

        if (this.options.showOffsetBlocks) {
            this.buildOffsetBlockVisualization();
        }

        if (this.options.showStrips) {
            this.buildStripVisualization();
        }

        if (this.options.showLots) {
            this.buildLotVisualization();
        }
    }

    /**
     * Get detected blocks (for external use).
     */
    getDetectedBlocks(): DetectedBlock[] {
        return this.blockManager.getBlocks();
    }

    /**
     * Get generated strips (for external use).
     */
    getStrips(): Strip[] {
        return this.blockManager.getStrips();
    }

    /**
     * Get generated lots (for external use).
     */
    getGeneratedLots(): GeneratedLot[] {
        return this.blockManager.getLots();
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
        if (this.stripLines) {
            this.debugGroup.remove(this.stripLines);
            this.stripLines.geometry.dispose();
            (this.stripLines.material as THREE.Material).dispose();
            this.stripLines = null;
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

    private buildBlockVisualization(): void {
        const blocks = this.blockManager.getBlocks();
        if (blocks.length === 0) return;

        const positions: number[] = [];
        const y = this.options.lineHeight + 0.1; // Slightly above tiles

        for (const block of blocks) {
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
        const offsetPolygons = this.blockManager.getOffsetPolygons();
        if (offsetPolygons.length === 0) return;

        const positions: number[] = [];
        const y = this.options.lineHeight + 0.15; // Between blocks and strips

        for (const polygon of offsetPolygons) {
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

    private buildStripVisualization(): void {
        const strips = this.blockManager.getStrips();
        if (strips.length === 0) return;

        const positions: number[] = [];
        const y = this.options.lineHeight + 0.2; // Between offset blocks and lots

        for (const strip of strips) {
            const polygon = strip.polygon;
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
            color: this.options.stripColor,
            linewidth: 2,
        });

        this.stripLines = new THREE.LineSegments(geometry, material);
        this.stripLines.name = "StripDebug";
        this.debugGroup.add(this.stripLines);
    }

    private buildLotVisualization(): void {
        const lots = this.blockManager.getLots();
        if (lots.length === 0) return;

        const positions: number[] = [];
        const y = this.options.lineHeight + 0.25; // Above strips

        for (const lot of lots) {
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
