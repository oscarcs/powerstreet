import * as THREE from "three/webgpu";

export class Renderer {
    private renderer: THREE.WebGPURenderer;
    private initialized = false;
    private initTask: Promise<void> | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGPURenderer({ canvas });
        this.renderer.shadowMap.enabled = true;
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (!this.initTask) {
            this.initTask = this.renderer
                .init()
                .then(() => {
                    this.renderer.setSize(window.innerWidth, window.innerHeight);
                    this.renderer.setPixelRatio(window.devicePixelRatio);
                    this.initialized = true;
                })
                .finally(() => {
                    this.initTask = null;
                });
        }

        await this.initTask;
    }

    public render(scene: THREE.Scene, camera: THREE.Camera): void {
        if (!this.initialized) {
            throw new Error("Renderer.initialize() must resolve before calling render().");
        }

        this.renderer.render(scene, camera);
    }

    public handleResize(): void {
        if (!this.initialized) {
            return;
        }

        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    public getAspectRatio(): number {
        return window.innerWidth / window.innerHeight;
    }

    public getRenderer(): THREE.WebGPURenderer {
        return this.renderer;
    }

    public dispose(): void {
        this.initialized = false;
        this.initTask = null;
        this.renderer.dispose();
    }
}
