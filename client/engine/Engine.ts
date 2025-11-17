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
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshLambertMaterial({ color: 0x606060 });
        const building = new THREE.Mesh(geometry, material);
        building.position.set(0, 0, 0);
        this.scene.add(building);

        const ambientLight = new THREE.AmbientLight(0xcccccc, 0.8);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 5);
        this.scene.add(directionalLight);
    }

    private setupEventListeners(): void {
        window.addEventListener("resize", () => {
            this.camera.updateAspectRatio(this.renderer.getAspectRatio());
            this.renderer.handleResize();
        });
    }

    private animate = (): void => {
        if (!this.isRunning) return;

        this.animationId = requestAnimationFrame(this.animate);

        this.inputManager.update();
        this.camera.update();

        this.renderer.render(this.scene, this.camera.getCamera());
    };

    public start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        this.animate();
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
        this.stop();
        this.inputManager.dispose();
        this.renderer.dispose();
    }
}
