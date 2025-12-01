import * as THREE from "three/webgpu";
import {
    pass,
    mrt,
    output,
    normalView,
    diffuseColor,
    velocity,
    add,
    vec4,
    directionToColor,
    colorToDirection,
    sample,
} from "three/tsl";
import { ssgi } from "three/addons/tsl/display/SSGINode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";

export class Renderer {
    private renderer: THREE.WebGPURenderer;
    private initialized = false;
    private initTask: Promise<void> | null = null;
    private postProcessing: THREE.PostProcessing | null = null;
    private ssgiEnabled = true;
    private ssgiPass: ReturnType<typeof ssgi> | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGPURenderer({ canvas });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (!this.initTask) {
            this.initTask = this.renderer
                .init()
                .then(() => {
                    this.renderer.setSize(window.innerWidth, window.innerHeight);
                    this.renderer.setPixelRatio(window.devicePixelRatio);
                    this.initialized = true;
                })
                .finally(() => {
                    this.initTask = null;
                });
        }

        await this.initTask;
    }

    public setupPostProcessing(scene: THREE.Scene, camera: THREE.Camera): void {
        this.postProcessing = new THREE.PostProcessing(this.renderer);

        // Create scene pass with Multiple Render Targets for SSGI
        const scenePass = pass(scene, camera);
        scenePass.setMRT(
            mrt({
                output: output,
                diffuseColor: diffuseColor,
                normal: directionToColor(normalView),
                velocity: velocity,
            }),
        );

        // Extract textures from MRT
        const scenePassColor = scenePass.getTextureNode("output");
        const scenePassDiffuse = scenePass.getTextureNode("diffuseColor");
        const scenePassDepth = scenePass.getTextureNode("depth");
        const scenePassNormal = scenePass.getTextureNode("normal");
        const scenePassVelocity = scenePass.getTextureNode("velocity");

        // Create SSGI pass
        const sceneNormal = sample((uv: any) => colorToDirection(scenePassNormal.sample(uv)));
        this.ssgiPass = ssgi(
            scenePassColor,
            scenePassDepth,
            sceneNormal,
            camera as THREE.PerspectiveCamera,
        );

        this.ssgiPass.sliceCount.value = 2;
        this.ssgiPass.stepCount.value = 8;
        this.ssgiPass.radius.value = 5;
        this.ssgiPass.thickness.value = 10;
        this.ssgiPass.aoIntensity.value = 1.0;
        this.ssgiPass.giIntensity.value = 1.0;
        this.ssgiPass.useTemporalFiltering = true;

        // Composite GI with scene: add ambient occlusion and indirect lighting
        const gi = this.ssgiPass.rgb;
        const ao = this.ssgiPass.a;
        const compositePass = vec4(
            add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
            scenePassColor.a,
        );

        // Apply Temporal Reprojection Anti-Aliasing for smoother results
        const traaPass = traa(
            compositePass,
            scenePassDepth,
            scenePassVelocity,
            camera as THREE.PerspectiveCamera,
        );
        this.postProcessing.outputNode = traaPass;
    }

    public render(scene: THREE.Scene, camera: THREE.Camera): void {
        if (!this.initialized) {
            throw new Error("Renderer.initialize() must resolve before calling render().");
        }

        if (this.ssgiEnabled && this.postProcessing) {
            this.postProcessing.render();
        } else {
            this.renderer.render(scene, camera);
        }
    }

    public setSSGIEnabled(enabled: boolean): void {
        this.ssgiEnabled = enabled;
    }

    public isSSGIEnabled(): boolean {
        return this.ssgiEnabled;
    }

    public getSSGIPass(): ReturnType<typeof ssgi> | null {
        return this.ssgiPass;
    }

    public handleResize(): void {
        if (!this.initialized) {
            return;
        }

        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    public getAspectRatio(): number {
        return window.innerWidth / window.innerHeight;
    }

    public getRenderer(): THREE.WebGPURenderer {
        return this.renderer;
    }

    public dispose(): void {
        this.initialized = false;
        this.initTask = null;
        this.renderer.dispose();
    }
}
