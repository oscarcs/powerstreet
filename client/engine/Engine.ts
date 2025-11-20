import * as THREE from "three";
import { Renderer } from "./Renderer";
import { Camera } from "./Camera";
import { InputManager } from "../input/InputManager";

export class Engine {
    private renderer: Renderer;
    private camera: Camera;
    private inputManager: InputManager;
    private scene: THREE.Scene;
    private isRunning: boolean = false;
    private animationId: number | null = null;
    private initializationPromise: Promise<void> | null = null;
    private startPromise: Promise<void> | null = null;
    private isDisposed = false;

    constructor(canvas: HTMLCanvasElement) {
        this.scene = new THREE.Scene();
        this.renderer = new Renderer(canvas);
        this.camera = new Camera(this.renderer.getAspectRatio());
        this.camera.initializeControls(this.renderer.getRenderer());

        this.inputManager = new InputManager(this.camera);

        this.setupScene();
        this.setupEventListeners();
    }

    private setupScene(): void {
        const bHeight = 5;
        const geometry = new THREE.BoxGeometry(1, bHeight, 1);
        const material = new THREE.MeshLambertMaterial({ color: 0xff6060 });
        const building = new THREE.Mesh(geometry, material);
        building.position.set(0, bHeight / 2, 0);
        building.castShadow = true;
        this.scene.add(building);

        const groundGeometry = new THREE.PlaneGeometry(100, 100);
        const groundMaterial = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0;
        ground.receiveShadow = true;
        this.scene.add(ground);

        const ambientLight = new THREE.AmbientLight(0xcccccc, 0.8);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(7, 20, 10);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        const cameraHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
        this.scene.add(cameraHelper);
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
        this.inputManager.dispose();
        this.renderer.dispose();
    }
}
