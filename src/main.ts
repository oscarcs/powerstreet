import { Engine } from './engine/Engine';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;

const engine = new Engine(canvas);
engine.start();

window.addEventListener('beforeunload', () => {
    engine.dispose();
});
