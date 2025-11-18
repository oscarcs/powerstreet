import { MainToolbar } from "./MainToolbar";
import { Store } from "tinybase";
import { Inspector } from "tinybase/ui-react-inspector";
import { Provider as TinyBaseProvider } from "tinybase/ui-react";

interface AppProps {
    store: Store;
}

const UILayer = () => {
    return (
        <div className="pointer-events-none absolute inset-0 z-10 text-slate-50">
            <MainToolbar />
            <Inspector />
        </div>
    );
};

export const App = ({ store }: AppProps) => {
    return (
        <TinyBaseProvider store={store}>
            <UILayer />
        </TinyBaseProvider>
    );
};

export default App;
