import { useEffect, useState } from "react";
import type { Engine } from "../engine/Engine";

interface DebugPanelProps {
    engine: Engine;
}

export const DebugPanel = ({ engine }: DebugPanelProps) => {
    const [fps, setFps] = useState(0);
    const [ssgiEnabled, setSsgiEnabled] = useState(engine.isSSGIEnabled());
    const [debugVisible, setDebugVisible] = useState(true); // Enable debug on page load
    const [showTiles, setShowTiles] = useState(true);
    const [showBlocks, setShowBlocks] = useState(true);
    const [showLots, setShowLots] = useState(true);
    const [skipLotMerging, setSkipLotMerging] = useState(false);
    const [skipBetaStrips, setSkipBetaStrips] = useState(false);
    const [debugStats, setDebugStats] = useState({ blocks: 0, lots: 0, tiles: 0, strips: 0 });

    // Enable debug mode on page load
    useEffect(() => {
        engine.enableDebug();
    }, [engine]);

    useEffect(() => {
        const interval = setInterval(() => {
            setFps(engine.getFps());
        }, 100);

        return () => clearInterval(interval);
    }, [engine]);

    useEffect(() => {
        if (!debugVisible) return;

        const updateStats = () => {
            const debugRenderer = engine.getDebugRenderer();
            setDebugStats({
                blocks: debugRenderer.getDetectedBlocks().length,
                lots: debugRenderer.getGeneratedLots().length,
                tiles: engine.getTileManager().getAllTiles().length,
                strips: debugRenderer.getStrips().length,
            });
        };

        updateStats();

        const interval = setInterval(updateStats, 500);
        return () => clearInterval(interval);
    }, [engine, debugVisible]);

    const handleSSGIToggle = () => {
        const newValue = !ssgiEnabled;
        setSsgiEnabled(newValue);
        engine.setSSGIEnabled(newValue);
    };

    const handleDebugToggle = () => {
        const newVisible = engine.toggleDebug();
        setDebugVisible(newVisible);
    };

    const handleShowTilesToggle = () => {
        const newValue = !showTiles;
        setShowTiles(newValue);
        engine.setDebugOptions({ showTiles: newValue });
    };

    const handleShowBlocksToggle = () => {
        const newValue = !showBlocks;
        setShowBlocks(newValue);
        engine.setDebugOptions({ showBlocks: newValue });
    };

    const handleShowLotsToggle = () => {
        const newValue = !showLots;
        setShowLots(newValue);
        engine.setDebugOptions({ showLots: newValue });
    };

    const handleSkipLotMergingToggle = () => {
        const newValue = !skipLotMerging;
        setSkipLotMerging(newValue);
        engine.setBlockManagerOptions({ skipLotMerging: newValue });
    };

    const handleSkipBetaStripsToggle = () => {
        const newValue = !skipBetaStrips;
        setSkipBetaStrips(newValue);
        engine.setBlockManagerOptions({ skipBetaStrips: newValue });
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
            <div className="my-1 border-t border-white/30" />
            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={debugVisible}
                    onChange={handleDebugToggle}
                    className="cursor-pointer"
                />
                <span>Debug View</span>
            </label>
            {debugVisible && (
                <>
                    <div className="ml-4 flex flex-col gap-1 text-xs">
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={showTiles}
                                onChange={handleShowTilesToggle}
                                className="cursor-pointer"
                            />
                            <span className="text-green-400">Tiles ({debugStats.tiles})</span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={showBlocks}
                                onChange={handleShowBlocksToggle}
                                className="cursor-pointer"
                            />
                            <span className="text-fuchsia-400">Blocks ({debugStats.blocks})</span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={showLots}
                                onChange={handleShowLotsToggle}
                                className="cursor-pointer"
                            />
                            <span className="text-yellow-400">Lots ({debugStats.lots})</span>
                        </label>
                    </div>
                    <div className="my-1 border-t border-white/30" />
                    <div className="ml-4 flex flex-col gap-1 text-xs">
                        <span className="text-orange-400">Strips ({debugStats.strips})</span>
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={skipBetaStrips}
                                onChange={handleSkipBetaStripsToggle}
                                className="cursor-pointer"
                            />
                            <span className="text-orange-300">Skip Beta Strips (show alpha only)</span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={skipLotMerging}
                                onChange={handleSkipLotMergingToggle}
                                className="cursor-pointer"
                            />
                            <span className="text-yellow-300">Skip Lot Merging</span>
                        </label>
                    </div>
                </>
            )}
        </div>
    );
};
