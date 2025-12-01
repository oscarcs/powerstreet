import { MainToolbar } from "./MainToolbar";
import { BuildingEditorPanel } from "./BuildingEditorPanel";
import { DebugPanel } from "./DebugPanel";
import { Store } from "tinybase";
import { Inspector } from "tinybase/ui-react-inspector";
import { Provider as TinyBaseProvider } from "tinybase/ui-react";
import { Engine } from "../engine/Engine";

interface AppProps {
    localStore: Store;
    worldsyncStore: Store;
    engine: Engine;
}

const UILayer = ({ engine }: { engine: Engine }) => {
    return (
        <div className="pointer-events-none absolute inset-0 z-10 text-slate-50">
            <MainToolbar />
            <BuildingEditorPanel />
            <Inspector />
            <DebugPanel getFps={() => engine.getFps()} />
        </div>
    );
};

export const App = ({ localStore, worldsyncStore, engine }: AppProps) => {
    return (
        <TinyBaseProvider storesById={{ localStore, worldsyncStore }}>
            <UILayer engine={engine} />
        </TinyBaseProvider>
    );
};

export default App;
