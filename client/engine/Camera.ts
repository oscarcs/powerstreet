import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export class Camera {
    private camera: THREE.PerspectiveCamera;
    private controls: OrbitControls | undefined;

    constructor(aspectRatio: number, renderer?: THREE.WebGPURenderer) {
        this.camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);

        if (renderer) {
            this.initializeControls(renderer);
        }
    }

    public initializeControls(renderer: THREE.WebGPURenderer): void {
        this.controls = new OrbitControls(this.camera, renderer.domElement);
        this.setupControls();
    }

    private setupControls(): void {
        if (!this.controls) return;

        this.controls.maxPolarAngle = Math.PI / 2;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 20;
        this.controls.enablePan = false;
        this.camera.position.set(3, 5, 5);
        this.controls.target.set(0, 0, 0);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.update();
    }

    public handleMovement(keys: { [key: string]: boolean }, moveSpeed: number): void {
        if (!this.controls) return;

        const direction = new THREE.Vector3();
        direction.subVectors(this.controls.target, this.camera.position);
        direction.y = 0;
        direction.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(direction, this.camera.up);
        right.normalize();

        const movement = new THREE.Vector3();

        if (keys.ArrowUp) {
            movement.add(direction.clone().multiplyScalar(moveSpeed));
        }
        if (keys.ArrowDown) {
            movement.add(direction.clone().multiplyScalar(-moveSpeed));
        }
        if (keys.ArrowRight) {
            movement.add(right.clone().multiplyScalar(moveSpeed));
        }
        if (keys.ArrowLeft) {
            movement.add(right.clone().multiplyScalar(-moveSpeed));
        }

        this.controls.target.add(movement);
        this.camera.position.add(movement);
    }

    public update(): void {
        if (this.controls) {
            this.controls.update();
        }
    }

    public updateAspectRatio(aspectRatio: number): void {
        this.camera.aspect = aspectRatio;
        this.camera.updateProjectionMatrix();
    }

    public getCamera(): THREE.PerspectiveCamera {
        return this.camera;
    }

    public getControls(): OrbitControls | undefined {
        return this.controls;
    }

    public setPosition(x: number, y: number, z: number): void {
        this.camera.position.set(x, y, z);
    }

    public setTarget(x: number, y: number, z: number): void {
        if (this.controls) {
            this.controls.target.set(x, y, z);
        }
    }
}
