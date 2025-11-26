import * as THREE from "three";
import { Renderer } from "./Renderer";
import { Camera } from "./Camera";
import { InputManager } from "../input/InputManager";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { BuildingManager } from "./BuildingManager";
import { EditGizmoManager } from "./EditGizmoManager";
import { LightmapManager } from "./LightmapManager";
import { LocalStore } from "../data/createLocalStore";

export class Engine {
    private renderer: Renderer;
    private camera: Camera;
    private inputManager: InputManager;
    private scene: THREE.Scene;
    private buildingManager: BuildingManager;
    private editGizmoManager: EditGizmoManager;
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
    private groundPlane: THREE.Plane;
    private lightmapManager: LightmapManager | null = null;
    private groundMesh: THREE.Mesh | null = null;

    constructor(canvas: HTMLCanvasElement, store: WorldsyncStore) {
        this.scene = new THREE.Scene();
        this.renderer = new Renderer(canvas);
        this.camera = new Camera(this.renderer.getAspectRatio());
        this.camera.initializeControls(this.renderer.getRenderer());

        this.inputManager = new InputManager(this.camera);
        this.buildingManager = new BuildingManager(this.scene, store);
        this.editGizmoManager = new EditGizmoManager(this.scene, store);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        this.setupScene();
        this.setupEventListeners();
    }

    public setLocalStore(localStore: LocalStore): void {
        this.localStore = localStore;
        this.buildingManager.setLocalStore(localStore);
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

    private getGroundIntersection(): THREE.Vector3 | null {
        this.raycaster.setFromCamera(this.mouse, this.camera.getCamera());
        const intersection = new THREE.Vector3();
        const result = this.raycaster.ray.intersectPlane(this.groundPlane, intersection);
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
                const worldPos = this.getGroundIntersection();
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
        if (!this.localStore || !this.editGizmoManager.isEditMode()) return;

        this.updateMousePosition(event);

        if (this.editGizmoManager.isDragging()) {
            const worldPos = this.getGroundIntersection();
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

        const worldPos = this.getGroundIntersection();
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
        // Large ground plane to receive shadows from buildings
        // Use subdivisions to capture shadow detail in the lightmap
        const groundGeometry = new THREE.PlaneGeometry(500, 500, 64, 64);
        // PlaneGeometry already has 'uv' attribute, no need to add
        const groundMaterial = new THREE.MeshPhongMaterial({
            color: 0xffffff,
            depthWrite: true,
        });
        this.groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
        this.groundMesh.rotation.x = -Math.PI / 2;
        this.groundMesh.position.y = 0;
        this.groundMesh.receiveShadow = true;
        this.scene.add(this.groundMesh);

        // Very low ambient light - lightmap provides the main illumination
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        // Main directional light for real-time lighting
        const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
        mainLight.position.set(50, 100, 50);
        this.scene.add(mainLight);

        // DEBUG: Add a test cube to verify shadow casting works in lightmap
        const testCubeGeom = new THREE.BoxGeometry(10, 20, 10);
        const testCubeMat = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
        const testCube = new THREE.Mesh(testCubeGeom, testCubeMat);
        testCube.position.set(20, 10, 20);
        testCube.castShadow = true;
        testCube.receiveShadow = true;
        this.scene.add(testCube);
        // We'll register this after lightmapManager is created
        (this as unknown as { testCube: THREE.Mesh }).testCube = testCube;
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

        this.inputManager.update();
        this.camera.update();

        // Update lightmap accumulation
        if (this.lightmapManager) {
            this.lightmapManager.update(this.camera.getCamera());
        }

        this.renderer.render(this.scene, this.camera.getCamera());
    };

    public async initialize(): Promise<void> {
        if (this.isDisposed) {
            throw new Error("Engine has been disposed and cannot be reinitialized.");
        }

        if (!this.initializationPromise) {
            this.initializationPromise = this.renderer
                .initialize()
                .then(() => {
                    // Initialize LightmapManager after renderer is ready
                    this.lightmapManager = new LightmapManager(
                        this.renderer.getRenderer(),
                        this.scene,
                        {
                            lightMapRes: 1024,
                            shadowMapRes: 1024, // Higher resolution shadow maps
                            lightCount: 4,
                            blendWindow: 200,
                            ambientWeight: 0.5,
                        },
                    );

                    // Register ground mesh for lightmapping (receives shadows but doesn't cast)
                    if (this.groundMesh) {
                        this.lightmapManager.registerMesh("ground", this.groundMesh, false, true);
                    }

                    // Register test cube
                    const testCube = (this as unknown as { testCube: THREE.Mesh }).testCube;
                    if (testCube) {
                        this.lightmapManager.registerMesh("testCube", testCube, true, true);
                    }

                    // Pass lightmap manager to building manager
                    this.buildingManager.setLightmapManager(this.lightmapManager);
                })
                .catch((error) => {
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
        if (this.lightmapManager) {
            this.lightmapManager.dispose();
        }
        this.renderer.dispose();
    }
}
