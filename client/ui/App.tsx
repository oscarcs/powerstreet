import { MainToolbar } from "./MainToolbar";
import { Store } from "tinybase";
import { Inspector } from "tinybase/ui-react-inspector";
import { Provider as TinyBaseProvider } from "tinybase/ui-react";

interface AppProps {
    localStore: Store;
    worldsyncStore: Store;
}

const UILayer = () => {
    return (
        <div className="pointer-events-none absolute inset-0 z-10 text-slate-50">
            <MainToolbar />
            <Inspector />
        </div>
    );
};

export const App = ({ localStore, worldsyncStore }: AppProps) => {
    return (
        <TinyBaseProvider storesById={{ localStore, worldsyncStore }}>
            <UILayer />
        </TinyBaseProvider>
    );
};

export default App;
