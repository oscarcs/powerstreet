import { createStore, Store } from "tinybase";

export function createLocalStore(): Store {
    const store = createStore();
    return store;
}