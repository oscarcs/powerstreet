import * as THREE from "three";
import { Renderer } from "./Renderer";
import { Camera } from "./Camera";
import { InputManager } from "../input/InputManager";
import { WorldsyncStore } from "../../shared/WorldsyncStore";
import { BuildingManager } from "./BuildingManager";
import { LocalStore } from "../data/createLocalStore";

export class Engine {
    private renderer: Renderer;
    private camera: Camera;
    private inputManager: InputManager;
    private scene: THREE.Scene;
    private buildingManager: BuildingManager;
    private localStore: LocalStore | null = null;
    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;
    private isRunning: boolean = false;
    private animationId: number | null = null;
    private initializationPromise: Promise<void> | null = null;
    private startPromise: Promise<void> | null = null;
    private isDisposed = false;
    private boundOnClick: ((event: MouseEvent) => void) | null = null;

    constructor(canvas: HTMLCanvasElement, store: WorldsyncStore) {
        this.scene = new THREE.Scene();
        this.renderer = new Renderer(canvas);
        this.camera = new Camera(this.renderer.getAspectRatio());
        this.camera.initializeControls(this.renderer.getRenderer());

        this.inputManager = new InputManager(this.camera);
        this.buildingManager = new BuildingManager(this.scene, store);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.setupScene();
        this.setupEventListeners();
    }

    public setLocalStore(localStore: LocalStore): void {
        this.localStore = localStore;
        this.buildingManager.setLocalStore(localStore);
        this.setupClickListener();
    }

    private setupClickListener(): void {
        const canvas = this.renderer.getRenderer().domElement;
        this.boundOnClick = this.onClick.bind(this);
        canvas.addEventListener("click", this.boundOnClick);
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

        if (this.boundOnClick) {
            const canvas = this.renderer.getRenderer().domElement;
            canvas.removeEventListener("click", this.boundOnClick);
            this.boundOnClick = null;
        }

        this.inputManager.dispose();
        this.buildingManager.dispose();
        this.renderer.dispose();
    }
}
