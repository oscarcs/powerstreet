import { createContext, ReactNode, useContext } from 'react';
import type { EngineBridge } from '../engineBridge';

const EngineBridgeContext = createContext<EngineBridge | null>(null);

interface EngineBridgeProviderProps {
    bridge: EngineBridge;
    children: ReactNode;
}

export const EngineBridgeProvider = ({ bridge, children }: EngineBridgeProviderProps) => (
    <EngineBridgeContext.Provider value={bridge}>{children}</EngineBridgeContext.Provider>
);

export const useEngineBridgeContext = (): EngineBridge => {
    const bridge = useContext(EngineBridgeContext);

    if (!bridge) {
        throw new Error('useEngineBridgeContext must be used within an EngineBridgeProvider');
    }

    return bridge;
};
