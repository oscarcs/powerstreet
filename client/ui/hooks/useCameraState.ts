import { useEffect, useState } from 'react';
import type { CameraState } from '../engineBridge';
import { useEngineBridge } from './useEngineBridge';

export const useCameraState = (): CameraState => {
    const bridge = useEngineBridge();
    const [cameraState, setCameraState] = useState<CameraState>(() => bridge.getCameraState());

    useEffect(() => {
        return bridge.subscribeToCamera(setCameraState);
    }, [bridge]);

    return cameraState;
};
