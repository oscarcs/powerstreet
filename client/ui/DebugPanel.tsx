import { useEffect, useState } from "react";

interface DebugPanelProps {
    getFps: () => number;
}

export const DebugPanel = ({ getFps }: DebugPanelProps) => {
    const [fps, setFps] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setFps(getFps());
        }, 100); // Update every 100ms

        return () => clearInterval(interval);
    }, [getFps]);

    return (
        <div className="pointer-events-none absolute bottom-4 left-4 z-20 rounded bg-black/50 px-2 py-1 font-mono text-sm text-white">
            {fps} FPS
        </div>
    );
};
