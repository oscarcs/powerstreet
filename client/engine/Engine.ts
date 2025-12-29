import * as THREE from "three";
import { Renderer } from "./Renderer";
import { Camera } from "./Camera";
import { InputManager } from "../input/InputManager";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { BuildingManager } from "./BuildingManager";
import { EditGizmoManager } from "./EditGizmoManager";
import { StreetManager } from "./StreetManager";
import { LocalStore } from "../data/createLocalStore";
import { TileManager } from "../spatial/TileManager";
import { DebugRenderer, DebugRenderOptions } from "./DebugRenderer";
import { TransportGraphUtils, STREET_LAYER_CONFIG, SnapResult } from "./TransportGraphUtils";

export class Engine {
    private renderer: Renderer;
    private camera: Camera;
    private inputManager: InputManager;
    private scene: THREE.Scene;
    private buildingManager: BuildingManager;
    private streetManager: StreetManager;
    private editGizmoManager: EditGizmoManager;
    private tileManager: TileManager;
    private debugRenderer: DebugRenderer;
    private store: WorldsyncStore;
    private localStore: LocalStore | null = null;
    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;
    private isRunning: boolean = false;
    private animationId: number | null = null;
    private initializationPromise: Promise<void> | null = null;
    private startPromise: Promise<void> | null = null;
    private isDisposed = false;
    private boundOnClick: ((event: MouseEvent) => void) | null = null;
    private boundOnMouseDown: ((event: MouseEvent) => void) | null = null;
    private boundOnMouseMove: ((event: MouseEvent) => void) | null = null;
    private boundOnMouseUp: ((event: MouseEvent) => void) | null = null;
    // private lightmapManager: LightmapManager | null = null;
    private groundMesh: THREE.Mesh | null = null;
    private fps: number = 0;
    private frameCount: number = 0;
    private fpsUpdateTime: number = performance.now();
    private lastStreetNodeId: string | null = null;
    private transportGraphUtils: TransportGraphUtils;
    private currentSnapResult: SnapResult | null = null;
    private isPreviewValid: boolean = true;
    private static readonly SNAP_THRESHOLD = 5; // meters

    constructor(canvas: HTMLCanvasElement, store: WorldsyncStore) {
        this.store = store;
        this.scene = new THREE.Scene();
        this.renderer = new Renderer(canvas);
        this.camera = new Camera(this.renderer.getAspectRatio());
        this.camera.initializeControls(this.renderer.getRenderer());

        // Initialize tile manager with 500m tiles
        this.tileManager = new TileManager({ tileSize: 500, debounceMs: 500 });

        this.inputManager = new InputManager(this.camera);
        this.buildingManager = new BuildingManager(this.scene, store);
        this.streetManager = new StreetManager(this.scene, store);
        this.editGizmoManager = new EditGizmoManager(this.scene, store);

        // Wire up tile manager to managers
        this.buildingManager.setTileManager(this.tileManager);
        this.streetManager.setTileManager(this.tileManager);

        // Initialize debug renderer
        this.debugRenderer = new DebugRenderer(this.scene, store, this.tileManager);

        // Initialize transport graph utilities for snapping/intersection detection
        this.transportGraphUtils = new TransportGraphUtils(store, STREET_LAYER_CONFIG);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.setupScene();
        this.setupEventListeners();
    }

    /**
     * Get the tile manager for external access (e.g., debugging, UI).
     */
    public getTileManager(): TileManager {
        return this.tileManager;
    }

    /**
     * Get the debug renderer for external access.
     */
    public getDebugRenderer(): DebugRenderer {
        return this.debugRenderer;
    }

    /**
     * Toggle debug visualization and return new visibility state.
     */
    public toggleDebug(): boolean {
        return this.debugRenderer.toggle();
    }

    /**
     * Set debug render options.
     */
    public setDebugOptions(options: Partial<DebugRenderOptions>): void {
        this.debugRenderer.setOptions(options);
    }

    public setLocalStore(localStore: LocalStore): void {
        this.localStore = localStore;
        this.buildingManager.setLocalStore(localStore);
        
        this.localStore.addValueListener("currentTool", () => {
            this.lastStreetNodeId = null;
            this.streetManager.clearPreview();
        });

        this.editGizmoManager.setLocalStore(localStore);
        this.setupClickListener();
        this.setupDragListeners();
    }

    private setupClickListener(): void {
        const canvas = this.renderer.getRenderer().domElement;
        this.boundOnClick = this.onClick.bind(this);
        canvas.addEventListener("click", this.boundOnClick);
    }

    private setupDragListeners(): void {
        const canvas = this.renderer.getRenderer().domElement;
        this.boundOnMouseDown = this.onMouseDown.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        this.boundOnMouseUp = this.onMouseUp.bind(this);

        canvas.addEventListener("mousedown", this.boundOnMouseDown);
        canvas.addEventListener("mousemove", this.boundOnMouseMove);
        canvas.addEventListener("mouseup", this.boundOnMouseUp);
    }

    private updateMousePosition(event: MouseEvent): void {
        const canvas = this.renderer.getRenderer().domElement;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    private getGroundIntersection(elevation: number = 0): THREE.Vector3 | null {
        this.raycaster.setFromCamera(this.mouse, this.camera.getCamera());
        const intersection = new THREE.Vector3();
        // Create a plane at the specified elevation (plane constant is negative of the distance from origin)
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevation);
        const result = this.raycaster.ray.intersectPlane(plane, intersection);
        return result;
    }

    private onMouseDown(event: MouseEvent): void {
        if (!this.localStore || !this.editGizmoManager.isEditMode()) return;

        this.updateMousePosition(event);
        this.raycaster.setFromCamera(this.mouse, this.camera.getCamera());

        // Temporarily hide the selected building so gizmos can be picked through it
        const editingBuildingId = this.editGizmoManager.getEditingBuildingId();
        const editingMesh = editingBuildingId
            ? this.buildingManager.getBuildingMesh(editingBuildingId)
            : null;
        const wasVisible = editingMesh?.visible ?? true;
        if (editingMesh) editingMesh.visible = false;

        const handleMeshes = this.editGizmoManager.getHandleMeshes();
        const intersects = this.raycaster.intersectObjects(handleMeshes, false);

        if (intersects.length > 0) {
            const clickedHandle = intersects[0].object;
            const nodeRowId = this.editGizmoManager.getNodeRowIdFromMesh(clickedHandle);

            if (nodeRowId) {
                const sectionElevation = this.editGizmoManager.getEditingSectionBaseElevation();
                const worldPos = this.getGroundIntersection(sectionElevation);
                if (worldPos) {
                    this.editGizmoManager.startDrag(nodeRowId, worldPos);
                    // Disable orbit controls during drag
                    this.camera.setControlsEnabled(false);
                }
            }
        }

        // Restore building visibility
        if (editingMesh) editingMesh.visible = wasVisible;
    }

    private onMouseMove(event: MouseEvent): void {
        if (!this.localStore) return;

        const currentTool = this.localStore.getValue("currentTool");

        if (currentTool === "draw-streets") {
            this.updateMousePosition(event);
            const intersection = this.getGroundIntersection(0);

            if (intersection) {
                // Check for snap targets at cursor position
                this.currentSnapResult = this.transportGraphUtils.findSnapTarget(
                    intersection.x,
                    intersection.z,
                    Engine.SNAP_THRESHOLD
                );

                if (this.lastStreetNodeId) {
                    const lastNode = this.store.getRow("streetNodes", this.lastStreetNodeId);
                    if (lastNode) {
                        const startPos = new THREE.Vector3(lastNode.x as number, 0, lastNode.z as number);

                        // Determine end position (snapped or raw)
                        const endX = this.currentSnapResult.type !== "none"
                            ? this.currentSnapResult.position.x
                            : intersection.x;
                        const endZ = this.currentSnapResult.type !== "none"
                            ? this.currentSnapResult.position.z
                            : intersection.z;

                        // Check if this edge would cross any existing edges
                        const crossingResult = this.transportGraphUtils.wouldCrossExistingEdge(
                            this.lastStreetNodeId,
                            endX,
                            endZ
                        );
                        this.isPreviewValid = !crossingResult.crosses;

                        this.streetManager.updatePreview(startPos, intersection, 10, {
                            snapResult: this.currentSnapResult,
                            isValid: this.isPreviewValid,
                        });
                    }
                } else {
                    // No active drawing, but still show snap feedback
                    // We pass a zero-length preview just to show snap indicators
                    if (this.currentSnapResult.type !== "none") {
                        const pos = new THREE.Vector3(
                            this.currentSnapResult.position.x,
                            0,
                            this.currentSnapResult.position.z
                        );
                        this.streetManager.updatePreview(pos, pos, 10, {
                            snapResult: this.currentSnapResult,
                            isValid: true,
                        });
                    } else {
                        this.streetManager.clearPreview();
                    }
                }
            } else {
                this.streetManager.clearPreview();
            }
            return;
        }

        if (!this.editGizmoManager.isEditMode()) return;

        this.updateMousePosition(event);

        if (this.editGizmoManager.isDragging()) {
            const sectionElevation = this.editGizmoManager.getEditingSectionBaseElevation();
            const worldPos = this.getGroundIntersection(sectionElevation);
            if (worldPos) {
                this.editGizmoManager.updateDrag(worldPos);
            }
        } else {
            // Handle hover effects
            this.raycaster.setFromCamera(this.mouse, this.camera.getCamera());

            // Temporarily hide the selected building so gizmos can be picked through it
            const editingBuildingId = this.editGizmoManager.getEditingBuildingId();
            const editingMesh = editingBuildingId
                ? this.buildingManager.getBuildingMesh(editingBuildingId)
                : null;
            const wasVisible = editingMesh?.visible ?? true;
            if (editingMesh) editingMesh.visible = false;

            const handleMeshes = this.editGizmoManager.getHandleMeshes();
            const intersects = this.raycaster.intersectObjects(handleMeshes, false);

            // Restore building visibility
            if (editingMesh) editingMesh.visible = wasVisible;

            if (intersects.length > 0) {
                const hoveredHandle = intersects[0].object;
                const nodeRowId = this.editGizmoManager.getNodeRowIdFromMesh(hoveredHandle);
                this.editGizmoManager.setHoveredNode(nodeRowId);
            } else {
                this.editGizmoManager.setHoveredNode(null);
            }
        }
    }

    private onMouseUp(_event: MouseEvent): void {
        if (!this.localStore || !this.editGizmoManager.isDragging()) return;

        const sectionElevation = this.editGizmoManager.getEditingSectionBaseElevation();
        const worldPos = this.getGroundIntersection(sectionElevation);
        if (worldPos) {
            this.editGizmoManager.endDrag(worldPos);
        } else {
            this.editGizmoManager.cancelDrag();
        }

        // Re-enable orbit controls
        this.camera.setControlsEnabled(true);
    }

    private onClick(event: MouseEvent): void {
        if (!this.localStore) return;

        const currentTool = this.localStore.getValue("currentTool");

        if (currentTool === "draw-streets") {
            this.updateMousePosition(event);
            const intersection = this.getGroundIntersection(0);

            if (intersection) {
                // Block creation if preview is invalid (would cross existing edge)
                if (this.lastStreetNodeId && !this.isPreviewValid) {
                    // Don't create the edge - it would cross an existing edge
                    return;
                }

                // Check for snap target at click position
                const snapResult = this.transportGraphUtils.findSnapTarget(
                    intersection.x,
                    intersection.z,
                    Engine.SNAP_THRESHOLD
                );

                let targetNodeId: string | undefined | null = null;

                if (snapResult.type === "node" && snapResult.nodeId) {
                    // Snap to existing node
                    targetNodeId = snapResult.nodeId;
                } else if (snapResult.type === "edge" && snapResult.edgeId) {
                    // Split the edge and snap to the new node
                    targetNodeId = this.transportGraphUtils.splitEdge(
                        snapResult.edgeId,
                        snapResult.position.x,
                        snapResult.position.z
                    );
                } else {
                    // Create new node at click position
                    targetNodeId = this.store.addRow("streetNodes", {
                        x: intersection.x,
                        z: intersection.z,
                    });
                }

                // Create edge from last node to target node
                if (this.lastStreetNodeId && targetNodeId && this.lastStreetNodeId !== targetNodeId) {
                    this.store.addRow("streetEdges", {
                        startNodeId: this.lastStreetNodeId,
                        endNodeId: targetNodeId,
                        width: 10,
                    });
                }

                // Update last node for next segment
                if (targetNodeId) {
                    this.lastStreetNodeId = targetNodeId;
                }
            }
            return;
        }

        if (currentTool !== "select") return;

        const canvas = this.renderer.getRenderer().domElement;
        const rect = canvas.getBoundingClientRect();

        // Convert mouse position to normalized device coordinates (-1 to +1)
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera.getCamera());

        const buildingMeshes = this.buildingManager.getBuildingMeshes();
        const intersects = this.raycaster.intersectObjects(buildingMeshes, false);

        if (intersects.length > 0) {
            const clickedMesh = intersects[0].object;
            const buildingId = this.buildingManager.getBuildingIdFromMesh(clickedMesh);
            const currentSelection = this.localStore.getValue("selectedBuildingId");

            if (buildingId === currentSelection) {
                this.localStore.delValue("selectedBuildingId");
            } else if (buildingId) {
                this.localStore.setValue("selectedBuildingId", buildingId);
            }
        }
    }

    private setupScene(): void {
        const groundGeometry = new THREE.PlaneGeometry(500, 500, 64, 64);
        const groundMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xcccccc,
            roughness: 0.9,
            metalness: 0.0,
            depthWrite: true,
        });
        this.groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
        this.groundMesh.rotation.x = -Math.PI / 2;
        this.groundMesh.position.y = 0;
        this.groundMesh.receiveShadow = true;
        this.scene.add(this.groundMesh);

        // Key light - main directional sun light with shadows
        const keyLight = new THREE.DirectionalLight(0xfffaf0, 2.0);
        keyLight.position.set(50, 100, 50);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 500;
        keyLight.shadow.camera.left = -100;
        keyLight.shadow.camera.right = 100;
        keyLight.shadow.camera.top = 100;
        keyLight.shadow.camera.bottom = -100;
        keyLight.shadow.bias = -0.001;
        keyLight.shadow.normalBias = 0.02;
        this.scene.add(keyLight);

        // Fill light - softer light from opposite direction
        const fillLight = new THREE.DirectionalLight(0x87ceeb, 0.5);
        fillLight.position.set(-30, 40, -30);
        this.scene.add(fillLight);

        // Rim/back light for depth separation
        const rimLight = new THREE.DirectionalLight(0xffd700, 0.3);
        rimLight.position.set(0, 20, -80);
        this.scene.add(rimLight);

        // Hemisphere light for natural sky/ground color blending
        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.4);
        this.scene.add(hemiLight);
    }

    private setupEventListeners(): void {
        window.addEventListener("resize", () => {
            this.camera.updateAspectRatio(this.renderer.getAspectRatio());
            this.renderer.handleResize();
        });
    }

    private animate = (): void => {
        if (!this.isRunning || this.isDisposed) return;

        this.animationId = requestAnimationFrame(this.animate);

        // Calculate FPS
        const currentTime = performance.now();
        this.frameCount++;
        
        // Update FPS every 200ms
        if (currentTime >= this.fpsUpdateTime + 200) {
            const elapsed = currentTime - this.fpsUpdateTime;
            this.fps = Math.round((this.frameCount * 1000) / elapsed);
            this.frameCount = 0;
            this.fpsUpdateTime = currentTime;
        }

        this.inputManager.update();
        this.camera.update();

        this.renderer.render(this.scene, this.camera.getCamera());
    };

    public async initialize(): Promise<void> {
        if (this.isDisposed) {
            throw new Error("Engine has been disposed and cannot be reinitialized.");
        }

        if (!this.initializationPromise) {
            this.initializationPromise = this.renderer.initialize().catch((error) => {
                this.initializationPromise = null;
                throw error;
            });
        }

        await this.initializationPromise;
    }

    public async start(): Promise<void> {
        if (this.isRunning || this.isDisposed) {
            return;
        }

        if (!this.startPromise) {
            this.startPromise = (async () => {
                try {
                    await this.initialize();

                    if (this.isDisposed) {
                        return;
                    }

                    this.renderer.setupPostProcessing(this.scene, this.camera.getCamera());

                    this.isRunning = true;
                    this.animate();
                } finally {
                    this.startPromise = null;
                }
            })();
        }

        await this.startPromise;
    }

    public stop(): void {
        this.isRunning = false;
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    public getScene(): THREE.Scene {
        return this.scene;
    }

    public getRenderer(): Renderer {
        return this.renderer;
    }

    public getCamera(): Camera {
        return this.camera;
    }

    public dispose(): void {
        if (this.isDisposed) {
            return;
        }

        this.isDisposed = true;
        this.stop();

        const canvas = this.renderer.getRenderer().domElement;

        if (this.boundOnClick) {
            canvas.removeEventListener("click", this.boundOnClick);
            this.boundOnClick = null;
        }

        if (this.boundOnMouseDown) {
            canvas.removeEventListener("mousedown", this.boundOnMouseDown);
            this.boundOnMouseDown = null;
        }

        if (this.boundOnMouseMove) {
            canvas.removeEventListener("mousemove", this.boundOnMouseMove);
            this.boundOnMouseMove = null;
        }

        if (this.boundOnMouseUp) {
            canvas.removeEventListener("mouseup", this.boundOnMouseUp);
            this.boundOnMouseUp = null;
        }

        this.inputManager.dispose();
        this.buildingManager.dispose();
        this.editGizmoManager.dispose();
        this.debugRenderer.dispose();
        this.renderer.dispose();
    }

    public getFps(): number {
        return this.fps;
    }

    public setSSGIEnabled(enabled: boolean): void {
        this.renderer.setSSGIEnabled(enabled);
    }

    public isSSGIEnabled(): boolean {
        return this.renderer.isSSGIEnabled();
    }
}
