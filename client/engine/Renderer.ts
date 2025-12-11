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
    uniform,
    mix,
} from "three/tsl";
import { ssgi } from "./SSGINode";
import type SSGINode from "./SSGINode";
import { traa } from "./TRAANode";

export class Renderer {
    private renderer: THREE.WebGPURenderer;
    private initialized = false;
    private initTask: Promise<void> | null = null;
    private postProcessing: THREE.PostProcessing | null = null;
    private ssgiEnabled = false;
    private ssgiPass: SSGINode | null = null;
    private ssgiBlend: ReturnType<typeof uniform<number>> | null = null;

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
        const ssgiPassNode = ssgi(
            scenePassColor,
            scenePassDepth,
            sceneNormal,
            camera as THREE.PerspectiveCamera,
        );
        this.ssgiPass = ssgiPassNode as unknown as SSGINode;

        this.ssgiPass.sliceCount.value = 1;
        this.ssgiPass.stepCount.value = 4;
        this.ssgiPass.radius.value = 1;
        this.ssgiPass.thickness.value = 10;
        this.ssgiPass.aoIntensity.value = 1.0;
        this.ssgiPass.giIntensity.value = 1.0;
        this.ssgiPass.useTemporalFiltering = true;
        this.ssgiPass.setEnabled(this.ssgiEnabled); // Start disabled for performance

        // Uniform to blend between raw scene and SSGI composite (0 = scene only, 1 = full SSGI)
        this.ssgiBlend = uniform(this.ssgiEnabled ? 1.0 : 0.0);

        // Composite GI with scene: add ambient occlusion and indirect lighting
        const gi = ssgiPassNode.rgb;
        const ao = ssgiPassNode.a;
        const ssgiComposite = vec4(
            add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
            scenePassColor.a,
        );
        
        // Mix between raw scene and SSGI composite based on blend uniform
        const compositePass = mix(scenePassColor, ssgiComposite, this.ssgiBlend);

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

        // Always use post-processing to keep temporal buffers warm
        if (this.postProcessing) {
            this.postProcessing.render();
        } else {
            this.renderer.render(scene, camera);
        }
    }

    public setSSGIEnabled(enabled: boolean): void {
        this.ssgiEnabled = enabled;
        // Toggle the blend uniform and SSGI computation
        if (this.ssgiBlend) {
            this.ssgiBlend.value = enabled ? 1.0 : 0.0;
        }
        // Enable/disable SSGI computation for performance
        if (this.ssgiPass) {
            this.ssgiPass.setEnabled(enabled);
        }
    }

    public isSSGIEnabled(): boolean {
        return this.ssgiEnabled;
    }

    public getSSGIPass(): SSGINode | null {
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
