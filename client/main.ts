import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Store } from "tinybase";
import { Engine } from "./engine/Engine";
import { createLocalStore, createWorldsyncStore } from "./data";
import App from "./ui/App";
import "./main.css";

const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
const uiContainer = document.getElementById("ui-root");

if (!canvas) {
    throw new Error('Canvas element with id="canvas" was not found.');
}

const localStore = createLocalStore();
const worldsyncStore = createWorldsyncStore();
const engine = new Engine(canvas);

let reactRoot: Root | null = null;

if (uiContainer) {
    reactRoot = createRoot(uiContainer);
    reactRoot.render(
        createElement(App, {
            localStore: localStore as unknown as Store,
            worldsyncStore: worldsyncStore as unknown as Store,
        }),
    );
} else {
    console.warn('UI container with id="ui-root" was not found. React UI will not mount.');
}

const engineStartPromise = (async () => {
    try {
        await engine.start();
    } catch (error) {
        console.error("Failed to start rendering engine.", error);
    }
})();

const cleanUp = async () => {
    reactRoot?.unmount();

    try {
        await engineStartPromise;
    } catch {
        // start errors are already reported above
    }

    engine.dispose();
};

window.addEventListener("beforeunload", () => cleanUp());

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        window.removeEventListener("beforeunload", () => cleanUp());
        void cleanUp();
    });
}
