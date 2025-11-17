import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Engine } from "./engine/Engine";
import { createEngineBridge } from "./ui/engineBridge";
import App from "./ui/App";
import "./main.css";

const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
const uiContainer = document.getElementById("ui-root");

if (!canvas) {
    throw new Error('Canvas element with id="canvas" was not found.');
}

const engine = new Engine(canvas);
const bridge = createEngineBridge(engine);
engine.start();

let reactRoot: Root | null = null;

if (uiContainer) {
    reactRoot = createRoot(uiContainer);
    reactRoot.render(createElement(App, { bridge }));
} else {
    console.warn('UI container with id="ui-root" was not found. React UI will not mount.');
}

const cleanUp = () => {
    reactRoot?.unmount();
    engine.dispose();
};

window.addEventListener("beforeunload", cleanUp);

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        window.removeEventListener("beforeunload", cleanUp);
        cleanUp();
    });
}
