import type { Engine } from '../engine/Engine';
import type { Camera } from '../engine/Camera';

export type Vector3Tuple = [number, number, number];

export interface CameraState {
    position: Vector3Tuple;
    target: Vector3Tuple;
}

type CameraSubscriber = (state: CameraState) => void;

export interface EngineBridge {
    engine: Engine;
    getCameraState: () => CameraState;
    setCameraState: (state: Partial<CameraState>) => void;
    focusOn: (target: Vector3Tuple) => void;
    subscribeToCamera: (subscriber: CameraSubscriber) => () => void;
}

const toTuple = (vector: { x: number; y: number; z: number }): Vector3Tuple => {
    return [vector.x, vector.y, vector.z] as Vector3Tuple;
};

export const createEngineBridge = (engine: Engine): EngineBridge => {
    const listeners = new Set<CameraSubscriber>();
    let frameId: number | null = null;

    const getCamera = (): Camera => engine.getCamera();

    const getCameraState = (): CameraState => {
        const camera = getCamera();
        const threeCamera = camera.getCamera();
        const controls = camera.getControls();

        const position = toTuple(threeCamera.position);
        const target = controls ? toTuple(controls.target) : [0, 0, 0] as Vector3Tuple;

        return { position, target };
    };

    const pump = (): void => {
        if (listeners.size === 0) {
            frameId = null;
            return;
        }

        const snapshot = getCameraState();
        listeners.forEach((listener) => listener(snapshot));
        frameId = window.requestAnimationFrame(pump);
    };

    const ensureLoop = (): void => {
        if (frameId === null) {
            frameId = window.requestAnimationFrame(pump);
        }
    };

    const subscribeToCamera = (subscriber: CameraSubscriber): (() => void) => {
        listeners.add(subscriber);
        subscriber(getCameraState());
        ensureLoop();

        return () => {
            listeners.delete(subscriber);
            if (listeners.size === 0 && frameId !== null) {
                window.cancelAnimationFrame(frameId);
                frameId = null;
            }
        };
    };

    const setCameraState = (state: Partial<CameraState>): void => {
        const camera = getCamera();

        if (state.position) {
            camera.setPosition(...state.position);
        }

        if (state.target) {
            camera.setTarget(...state.target);
        }
    };

    const focusOn = (target: Vector3Tuple): void => {
        setCameraState({ target });
    };

    return {
        engine,
        getCameraState,
        setCameraState,
        focusOn,
        subscribeToCamera,
    };
};
