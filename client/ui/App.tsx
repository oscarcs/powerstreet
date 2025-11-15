import { useCallback } from 'react';
import type { EngineBridge, Vector3Tuple } from './engineBridge';
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
        <div
            className="pointer-events-auto rounded-xl border border-white/15 bg-slate-900/70 p-5 text-slate-50 shadow-2xl backdrop-blur-xl"
            role="status"
            aria-live="polite"
        >
            <h1 className="text-lg font-semibold">Camera</h1>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] items-start gap-x-3 gap-y-2 text-sm">
                <dt className="text-slate-300">Position</dt>
                <dd className="m-0 tabular-nums text-slate-100">{formatVector(position)}</dd>
                <dt className="text-slate-300">Target</dt>
                <dd className="m-0 tabular-nums text-slate-100">{formatVector(target)}</dd>
            </dl>
            <button
                type="button"
                onClick={resetView}
                className="mt-4 inline-flex items-center rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white shadow-lg transition duration-150 ease-in-out hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
            >
                Reset View
            </button>
        </div>
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
