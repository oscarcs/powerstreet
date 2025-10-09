import * as THREE from 'three';

export class Renderer {
    private renderer: THREE.WebGLRenderer;

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({ canvas });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
    }

    public render(scene: THREE.Scene, camera: THREE.Camera): void {
        this.renderer.render(scene, camera);
    }

    public handleResize(): void {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    public getAspectRatio(): number {
        return window.innerWidth / window.innerHeight;
    }

    public getRenderer(): THREE.WebGLRenderer {
        return this.renderer;
    }

    public dispose(): void {
        this.renderer.dispose();
    }
}