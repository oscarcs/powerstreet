import { Camera } from '../engine/Camera';

export class InputManager {
    private camera: Camera;
    private moveSpeed: number = 0.1;
    private keys: { [key: string]: boolean } = {
        ArrowUp: false,
        ArrowDown: false,
        ArrowLeft: false,
        ArrowRight: false
    };

    constructor(camera: Camera) {
        this.camera = camera;
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    }

    private handleKeyDown = (event: KeyboardEvent): void => {
        if (event.code in this.keys) {
            this.keys[event.code] = true;
        }
    };

    private handleKeyUp = (event: KeyboardEvent): void => {
        if (event.code in this.keys) {
            this.keys[event.code] = false;
        }
    };

    public update(): void {
        if (this.keys.ArrowUp || this.keys.ArrowDown || this.keys.ArrowLeft || this.keys.ArrowRight) {
            this.camera.handleMovement(this.keys, this.moveSpeed);
        }
    }

    public setMoveSpeed(speed: number): void {
        this.moveSpeed = speed;
    }

    public getMoveSpeed(): number {
        return this.moveSpeed;
    }

    public dispose(): void {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
    }
}