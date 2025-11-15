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
import { Item, ItemGroup, ItemHeader, ItemTitle } from './components/item';
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
                <ItemGroup className="gap-2">
                    <Item size="sm">
                        <ItemHeader>
                            <ItemTitle>Position</ItemTitle>
                            <span className="tabular-nums text-sm text-foreground">
                                {formatVector(position)}
                            </span>
                        </ItemHeader>
                    </Item>
                    <Item size="sm">
                        <ItemHeader>
                            <ItemTitle>Target</ItemTitle>
                            <span className="tabular-nums text-sm text-foreground">
                                {formatVector(target)}
                            </span>
                        </ItemHeader>
                    </Item>
                </ItemGroup>
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
