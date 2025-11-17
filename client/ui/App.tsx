import type { EngineBridge } from "./engineBridge";
import { EngineBridgeProvider } from "./context/EngineBridgeContext";
import { MainToolbar } from "./MainToolbar";

interface AppProps {
    bridge: EngineBridge;
}

const UILayer = () => {
    return (
        <div className="pointer-events-none absolute inset-0 z-10 text-slate-50">
            <MainToolbar />
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
