import { useEffect, useState } from "react";
import type { Engine } from "../engine/Engine";

interface DebugPanelProps {
    engine: Engine;
}

export const DebugPanel = ({ engine }: DebugPanelProps) => {
    const [fps, setFps] = useState(0);
    const [ssgiEnabled, setSsgiEnabled] = useState(engine.isSSGIEnabled());

    useEffect(() => {
        const interval = setInterval(() => {
            setFps(engine.getFps());
        }, 100); // Update every 100ms

        return () => clearInterval(interval);
    }, [engine]);

    const handleSSGIToggle = () => {
        const newValue = !ssgiEnabled;
        setSsgiEnabled(newValue);
        engine.setSSGIEnabled(newValue);
    };

    return (
        <div className="pointer-events-auto absolute bottom-4 left-4 z-20 flex flex-col gap-2 rounded bg-black/50 px-3 py-2 font-mono text-sm text-white">
            <div>{fps} FPS</div>
            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={ssgiEnabled}
                    onChange={handleSSGIToggle}
                    className="cursor-pointer"
                />
                <span>SSGI</span>
            </label>
        </div>
    );
};
