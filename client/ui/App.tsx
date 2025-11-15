import { useCallback } from 'react';
import type { EngineBridge, Vector3Tuple } from './engineBridge';
import { Button } from './components/button';
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from './components/card';
import { EngineBridgeProvider } from './context/EngineBridgeContext';
import { useCameraState } from './hooks/useCameraState';
import { useEngineBridge } from './hooks/useEngineBridge';

interface AppProps {
    bridge: EngineBridge;
}

const formatVector = (vector: Vector3Tuple): string => {
    return vector.map((value: number) => value.toFixed(2)).join(', ');
};

const CameraStatusPanel = () => {
    const bridge = useEngineBridge();
    const { position, target } = useCameraState();

    const resetView = useCallback(() => {
        bridge.setCameraState({ position: [0, 5, 0], target: [0, 0, 0] });
    }, [bridge]);

    return (
        <Card className="pointer-events-auto" role="status" aria-live="polite">
            <CardHeader>
                <CardTitle>Camera</CardTitle>
            </CardHeader>
            <CardContent>
                <dl className="grid grid-cols-[max-content_1fr] items-start gap-x-3 gap-y-2 text-sm">
                    <dt>Position</dt>
                    <dd className="m-0 tabular-nums">{formatVector(position)}</dd>
                    <dt>Target</dt>
                    <dd className="m-0 tabular-nums">{formatVector(target)}</dd>
                </dl>
            </CardContent>
            <CardFooter>
                <Button type="button" onClick={resetView}>
                    Reset View
                </Button>
            </CardFooter>
        </Card>
    );
};

const UILayer = () => {
    return (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-6 text-slate-50">
            <div className="flex w-full max-w-xs flex-col gap-3">
                <CameraStatusPanel />
            </div>
        </div>
    );
};

export const App = ({ bridge }: AppProps) => {
    return (
        <EngineBridgeProvider bridge={bridge}>
            <UILayer />
        </EngineBridgeProvider>
    );
};

export default App;
