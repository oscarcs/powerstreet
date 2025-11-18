import { createContext, ReactNode, useContext } from "react";
import { Store } from "tinybase";

const DataContext = createContext<Store | null>(null);

interface DataProviderProps {
    store: Store;
    children: ReactNode;
}

export const DataProvider = ({ store, children }: DataProviderProps) => (
    <DataContext.Provider value={store}>{children}</DataContext.Provider>
);

export const useDataContext = (): Store => {
    const store = useContext(DataContext);

    if (!store) {
        throw new Error("useDataContext must be used within a DataProvider");
    }

    return store;
};
