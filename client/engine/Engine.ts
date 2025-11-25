import * as THREE from "three";
import { Renderer } from "./Renderer";
import { Camera } from "./Camera";
import { InputManager } from "../input/InputManager";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { BuildingManager } from "./BuildingManager";
import { EditGizmoManager } from "./EditGizmoManager";
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
            const handleMeshes = this.editGizmoManager.getHandleMeshes();
            const intersects = this.raycaster.intersectObjects(handleMeshes, false);

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
        const groundGeometry = new THREE.PlaneGeometry(100, 100);
        const groundMaterial = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0;
        this.scene.add(ground);

        const ambientLight = new THREE.AmbientLight(0xcccccc, 0.8);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(7, 20, 10);
        this.scene.add(directionalLight);
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
        this.renderer.dispose();
    }
}
