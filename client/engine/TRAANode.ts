import {
    HalfFloatType,
    Vector2,
    RenderTarget,
    RendererUtils,
    QuadMesh,
    NodeMaterial,
    TempNode,
    NodeUpdateType,
    Matrix4,
    DepthTexture,
    PerspectiveCamera,
    WebGPURenderer,
} from "three/webgpu";
import {
    add,
    float,
    If,
    Fn,
    max,
    nodeObject,
    texture,
    uniform,
    uv,
    vec2,
    vec4,
    luminance,
    convertToTexture,
    passTexture,
    velocity,
    getViewPosition,
    viewZToPerspectiveDepth,
    struct,
    ivec2,
    mix,
} from "three/tsl";

const _quadMesh = new QuadMesh();
const _size = new Vector2();

let _rendererState: any;

function _halton(index: number, base: number): number {
    let fraction = 1;
    let result = 0;
    while (index > 0) {
        fraction /= base;
        result += fraction * (index % base);
        index = Math.floor(index / base);
    }
    return result;
}

const _haltonOffsets: [number, number][] = Array.from({ length: 32 }, (_, index) => [
    _halton(index + 1, 2),
    _halton(index + 1, 3),
]);

/**
 * A special node that applies TRAA (Temporal Reprojection Anti-Aliasing).
 * Modified version with reset() method for clearing temporal history.
 */
class TRAANode extends TempNode {
    static get type() {
        return "TRAANode";
    }

    isTRAANode = true;
    updateBeforeType = NodeUpdateType.FRAME;

    beautyNode: any;
    depthNode: any;
    velocityNode: any;
    camera: PerspectiveCamera;

    depthThreshold = 0.0005;
    edgeDepthDiff = 0.001;
    maxVelocityLength = 128;
    useSubpixelCorrection = true;

    private _jitterIndex = 0;
    private _invSize: any;
    private _historyRenderTarget: RenderTarget;
    private _resolveRenderTarget: RenderTarget;
    private _resolveMaterial: NodeMaterial;
    private _textureNode: any;
    private _originalProjectionMatrix: Matrix4;
    private _cameraNearFar: any;
    private _cameraWorldMatrix: any;
    private _cameraWorldMatrixInverse: any;
    private _cameraProjectionMatrixInverse: any;
    private _previousCameraWorldMatrix: any;
    private _previousCameraProjectionMatrixInverse: any;
    private _previousDepthNode: any;
    private _needsPostProcessingSync = false;
    private _needsReset = false;
    private _skipBlendFrames = 0;
    private _forceCurrentFrameWeight: any;

    constructor(beautyNode: any, depthNode: any, velocityNode: any, camera: PerspectiveCamera) {
        super("vec4");

        this.beautyNode = beautyNode;
        this.depthNode = depthNode;
        this.velocityNode = velocityNode;
        this.camera = camera;

        this._invSize = uniform(new Vector2());
        this._forceCurrentFrameWeight = uniform(0); // 0 = normal blending, 1 = 100% current frame

        this._historyRenderTarget = new RenderTarget(1, 1, {
            depthBuffer: false,
            type: HalfFloatType,
            depthTexture: new DepthTexture(1, 1),
        });
        this._historyRenderTarget.texture.name = "TRAANode.history";

        this._resolveRenderTarget = new RenderTarget(1, 1, {
            depthBuffer: false,
            type: HalfFloatType,
        });
        this._resolveRenderTarget.texture.name = "TRAANode.resolve";

        this._resolveMaterial = new NodeMaterial();
        this._resolveMaterial.name = "TRAA.resolve";

        this._textureNode = passTexture(this as any, this._resolveRenderTarget.texture);

        this._originalProjectionMatrix = new Matrix4();

        this._cameraNearFar = uniform(new Vector2());
        this._cameraWorldMatrix = uniform(new Matrix4());
        this._cameraWorldMatrixInverse = uniform(new Matrix4());
        this._cameraProjectionMatrixInverse = uniform(new Matrix4());
        this._previousCameraWorldMatrix = uniform(new Matrix4());
        this._previousCameraProjectionMatrixInverse = uniform(new Matrix4());

        this._previousDepthNode = texture(new DepthTexture(1, 1));
    }

    /**
     * Resets the temporal history buffers. Call this when switching render modes
     * to prevent ghosting artifacts from stale history data.
     */
    reset(_renderer: WebGPURenderer): void {
        this._needsReset = true;
        this._skipBlendFrames = 16; // Skip blending for several frames after reset
    }

    private _performReset(renderer: WebGPURenderer, beautyRenderTarget: RenderTarget): void {
        // Clear history render target
        renderer.setRenderTarget(this._historyRenderTarget);
        renderer.clear();

        // Clear resolve render target
        renderer.setRenderTarget(this._resolveRenderTarget);
        renderer.clear();

        renderer.setRenderTarget(null);

        // Copy current beauty buffer to history to prevent blending with black
        renderer.copyTextureToTexture(
            beautyRenderTarget.texture,
            this._historyRenderTarget.texture,
        );

        // Reset jitter index
        this._jitterIndex = 0;

        this._needsReset = false;
    }

    getTextureNode() {
        return this._textureNode;
    }

    setSize(width: number, height: number) {
        this._historyRenderTarget.setSize(width, height);
        this._resolveRenderTarget.setSize(width, height);

        this._invSize.value.set(1 / width, 1 / height);
    }

    setViewOffset(width: number, height: number) {
        // save original/unjittered projection matrix for velocity pass
        this.camera.updateProjectionMatrix();
        this._originalProjectionMatrix.copy(this.camera.projectionMatrix);

        velocity.setProjectionMatrix(this._originalProjectionMatrix);

        const viewOffset = {
            fullWidth: width,
            fullHeight: height,
            offsetX: 0,
            offsetY: 0,
            width: width,
            height: height,
        };

        const jitterOffset = _haltonOffsets[this._jitterIndex];

        (this.camera as PerspectiveCamera).setViewOffset(
            viewOffset.fullWidth,
            viewOffset.fullHeight,
            viewOffset.offsetX + jitterOffset[0] - 0.5,
            viewOffset.offsetY + jitterOffset[1] - 0.5,
            viewOffset.width,
            viewOffset.height,
        );
    }

    clearViewOffset() {
        (this.camera as PerspectiveCamera).clearViewOffset();

        velocity.setProjectionMatrix(null);

        // update jitter index
        this._jitterIndex++;
        this._jitterIndex = this._jitterIndex % (_haltonOffsets.length - 1);
    }

    updateBefore(frame: any) {
        const { renderer } = frame;

        // Handle skip blend frames - force 100% current frame weight during reset period
        if (this._skipBlendFrames > 0) {
            this._forceCurrentFrameWeight.value = 1;
            this._skipBlendFrames--;
        } else {
            this._forceCurrentFrameWeight.value = 0;
        }

        // store previous frame matrices before updating current ones
        this._previousCameraWorldMatrix.value.copy(this._cameraWorldMatrix.value);
        this._previousCameraProjectionMatrixInverse.value.copy(
            this._cameraProjectionMatrixInverse.value,
        );

        // update camera matrices uniforms
        this._cameraNearFar.value.set(this.camera.near, this.camera.far);
        this._cameraWorldMatrix.value.copy(this.camera.matrixWorld);
        this._cameraWorldMatrixInverse.value.copy(this.camera.matrixWorldInverse);
        this._cameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse);

        // keep the TRAA in sync with the dimensions of the beauty node
        const beautyRenderTarget = this.beautyNode.isRTTNode
            ? this.beautyNode.renderTarget
            : this.beautyNode.passNode.renderTarget;

        // Handle reset if requested (needs beautyRenderTarget to be available)
        if (this._needsReset) {
            this._performReset(renderer, beautyRenderTarget);
        }

        const width = beautyRenderTarget.texture.width;
        const height = beautyRenderTarget.texture.height;

        if (this._needsPostProcessingSync === true) {
            this.setViewOffset(width, height);
            this._needsPostProcessingSync = false;
        }

        _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

        const needsRestart =
            this._historyRenderTarget.width !== width ||
            this._historyRenderTarget.height !== height;
        this.setSize(width, height);

        // every time when the dimensions change we need fresh history data
        if (needsRestart === true) {
            // bind and clear render target to make sure they are initialized after the resize
            renderer.setRenderTarget(this._historyRenderTarget);
            renderer.clear();

            renderer.setRenderTarget(this._resolveRenderTarget);
            renderer.clear();

            // make sure to reset the history with the contents of the beauty buffer
            renderer.copyTextureToTexture(
                beautyRenderTarget.texture,
                this._historyRenderTarget.texture,
            );
        }

        // resolve
        renderer.setRenderTarget(this._resolveRenderTarget);
        _quadMesh.material = this._resolveMaterial;
        (_quadMesh as any).name = "TRAA";
        _quadMesh.render(renderer);
        renderer.setRenderTarget(null);

        // update history
        renderer.copyTextureToTexture(
            this._resolveRenderTarget.texture,
            this._historyRenderTarget.texture,
        );

        // Copy current depth to previous depth buffer
        const size = renderer.getDrawingBufferSize(_size);

        if (
            this._historyRenderTarget.height === size.height &&
            this._historyRenderTarget.width === size.width
        ) {
            const currentDepth = this.depthNode.value;
            renderer.copyTextureToTexture(currentDepth, this._historyRenderTarget.depthTexture);
            this._previousDepthNode.value = this._historyRenderTarget.depthTexture;
        }

        // restore
        RendererUtils.restoreRendererState(renderer, _rendererState);
    }

    setup(builder: any) {
        const postProcessing = builder.context.postProcessing;

        if (postProcessing) {
            this._needsPostProcessingSync = true;

            postProcessing.context.onBeforePostProcessing = () => {
                const size = builder.renderer.getDrawingBufferSize(_size);
                this.setViewOffset(size.width, size.height);
            };

            postProcessing.context.onAfterPostProcessing = () => {
                this.clearViewOffset();
            };
        }

        const currentDepthStruct = struct({
            closestDepth: "float",
            closestPositionTexel: "vec2",
            farthestDepth: "float",
        });

        // Samples 3×3 neighborhood pixels and returns the closest and farthest depths.
        const sampleCurrentDepth = Fn(([positionTexel]: [any]) => {
            const closestDepth = float(2).toVar();
            const closestPositionTexel = vec2(0).toVar();
            const farthestDepth = float(-1).toVar();

            for (let x = -1; x <= 1; ++x) {
                for (let y = -1; y <= 1; ++y) {
                    const neighbor = positionTexel.add(vec2(x, y)).toVar();
                    const depth = this.depthNode.load(neighbor).r.toVar();

                    If(depth.lessThan(closestDepth), () => {
                        closestDepth.assign(depth);
                        closestPositionTexel.assign(neighbor);
                    });

                    If(depth.greaterThan(farthestDepth), () => {
                        farthestDepth.assign(depth);
                    });
                }
            }

            return currentDepthStruct(closestDepth, closestPositionTexel, farthestDepth);
        });

        // Samples a previous depth and reproject it using the current camera matrices.
        const samplePreviousDepth = (uvCoord: any) => {
            const depth = this._previousDepthNode.sample(uvCoord).r;
            const positionView = getViewPosition(
                uvCoord,
                depth,
                this._previousCameraProjectionMatrixInverse,
            );
            const positionWorld = this._previousCameraWorldMatrix.mul(vec4(positionView, 1)).xyz;
            const viewZ = this._cameraWorldMatrixInverse.mul(vec4(positionWorld, 1)).z;
            return viewZToPerspectiveDepth(viewZ, this._cameraNearFar.x, this._cameraNearFar.y);
        };

        // Optimized version of AABB clipping.
        const clipAABB = Fn(([currentColor, historyColor, minColor, maxColor]: any[]) => {
            const pClip = maxColor.rgb.add(minColor.rgb).mul(0.5);
            const eClip = maxColor.rgb.sub(minColor.rgb).mul(0.5).add(1e-7);
            const vClip = historyColor.sub(vec4(pClip, currentColor.a));
            const vUnit = vClip.xyz.div(eClip);
            const absUnit = vUnit.abs();
            const maxUnit = max(absUnit.x, absUnit.y, absUnit.z);
            return maxUnit
                .greaterThan(1)
                .select(vec4(pClip, currentColor.a).add(vClip.div(maxUnit)), historyColor);
        }).setLayout({
            name: "clipAABB",
            type: "vec4",
            inputs: [
                { name: "currentColor", type: "vec4" },
                { name: "historyColor", type: "vec4" },
                { name: "minColor", type: "vec4" },
                { name: "maxColor", type: "vec4" },
            ],
        });

        // Performs variance clipping.
        const varianceClipping = Fn(
            ([positionTexel, currentColor, historyColor, gamma]: any[]) => {
                const offsets = [
                    [-1, -1],
                    [-1, 1],
                    [1, -1],
                    [1, 1],
                    [1, 0],
                    [0, -1],
                    [0, 1],
                    [-1, 0],
                ];

                const moment1 = currentColor.toVar();
                const moment2 = currentColor.pow2().toVar();

                for (const [x, y] of offsets) {
                    // Use max() to prevent NaN values from propagating.
                    const neighbor = this.beautyNode.offset(ivec2(x, y)).load(positionTexel).max(0);
                    moment1.addAssign(neighbor);
                    moment2.addAssign(neighbor.pow2());
                }

                const N = float(offsets.length + 1);
                const mean = moment1.div(N);
                const variance = moment2.div(N).sub(mean.pow2()).max(0).sqrt().mul(gamma);
                const minColor = mean.sub(variance);
                const maxColor = mean.add(variance);

                return clipAABB(mean.clamp(minColor, maxColor), historyColor, minColor, maxColor);
            },
        );

        // Returns the amount of subpixel (expressed within [0, 1]) in the velocity.
        const subpixelCorrection = Fn(([velocityUV, textureSize]: any[]) => {
            const velocityTexel = velocityUV.mul(textureSize);
            const phase = velocityTexel.fract().abs();
            const weight = max(phase, phase.oneMinus());
            return weight.x.mul(weight.y).oneMinus().div(0.75);
        }).setLayout({
            name: "subpixelCorrection",
            type: "float",
            inputs: [
                { name: "velocityUV", type: "vec2" },
                { name: "textureSize", type: "ivec2" },
            ],
        });

        // Flicker reduction based on luminance weighing.
        const flickerReduction = Fn(([currentColor, historyColor, currentWeight]: any[]) => {
            const historyWeight = currentWeight.oneMinus();
            const compressedCurrent = currentColor.mul(
                float(1).div(max(currentColor.r, currentColor.g, currentColor.b).add(1)),
            );
            const compressedHistory = historyColor.mul(
                float(1).div(max(historyColor.r, historyColor.g, historyColor.b).add(1)),
            );

            const luminanceCurrent = luminance(compressedCurrent.rgb);
            const luminanceHistory = luminance(compressedHistory.rgb);

            currentWeight.mulAssign(float(1).div(luminanceCurrent.add(1)));
            historyWeight.mulAssign(float(1).div(luminanceHistory.add(1)));

            return add(currentColor.mul(currentWeight), historyColor.mul(historyWeight))
                .div(max(currentWeight.add(historyWeight), 0.00001))
                .toVar();
        });

        const historyNode = texture(this._historyRenderTarget.texture);

        const resolve = Fn(() => {
            const uvNode = uv();
            const textureSize = this.beautyNode.size();
            const positionTexel = uvNode.mul(textureSize);

            // sample the closest and farthest depths in the current buffer
            const currentDepth = sampleCurrentDepth(positionTexel);
            const closestDepth = currentDepth.get("closestDepth");
            const closestPositionTexel = currentDepth.get("closestPositionTexel");
            const farthestDepth = currentDepth.get("farthestDepth");

            // convert the NDC offset to UV offset
            const offsetUV = this.velocityNode.load(closestPositionTexel).xy.mul(vec2(0.5, -0.5));

            // sample the previous depth
            const historyUV = uvNode.sub(offsetUV);
            const previousDepth = samplePreviousDepth(historyUV);

            // history is considered valid when the UV is in range and there's no disocclusion except on edges
            const isValidUV = historyUV.greaterThanEqual(0).all().and(historyUV.lessThanEqual(1).all());
            const isEdge = farthestDepth.sub(closestDepth).greaterThan(this.edgeDepthDiff);
            const isDisocclusion = closestDepth.sub(previousDepth).greaterThan(this.depthThreshold);
            const hasValidHistory = isValidUV.and(isEdge.or(isDisocclusion.not()));

            // sample the current and previous colors
            const currentColor = this.beautyNode.sample(uvNode);
            const historyColor = historyNode.sample(uvNode.sub(offsetUV));

            // increase the weight towards the current frame under motion
            const motionFactor = uvNode
                .sub(historyUV)
                .mul(textureSize)
                .length()
                .div(this.maxVelocityLength)
                .saturate();
            const currentWeight = float(0.05).toVar(); // A minimum weight

            if (this.useSubpixelCorrection) {
                // Increase the minimum weight towards the current frame when the velocity is more subpixel.
                currentWeight.addAssign(subpixelCorrection(offsetUV, textureSize).mul(0.25));
            }

            currentWeight.assign(
                hasValidHistory.select(currentWeight.add(motionFactor).saturate(), 1),
            );

            // Perform neighborhood clipping/clamping. We use variance clipping here.
            const varianceGamma = mix(0.5, 1, motionFactor.oneMinus().pow2());
            const clippedHistoryColor = varianceClipping(
                positionTexel,
                currentColor,
                historyColor,
                varianceGamma,
            );

            // flicker reduction based on luminance weighing
            const output = flickerReduction(currentColor, clippedHistoryColor, currentWeight);

            // During reset period, completely bypass temporal blending and output current frame directly
            const finalOutput = mix(output, currentColor, this._forceCurrentFrameWeight);

            return finalOutput;
        });

        // materials
        this._resolveMaterial.colorNode = resolve();

        return this._textureNode;
    }

    dispose() {
        this._historyRenderTarget.dispose();
        this._resolveRenderTarget.dispose();
        this._resolveMaterial.dispose();
    }
}

export default TRAANode;

/**
 * TSL function for creating a TRAA node for Temporal Reprojection Anti-Aliasing.
 */
export const traa = (beautyNode: any, depthNode: any, velocityNode: any, camera: PerspectiveCamera) =>
    nodeObject(new TRAANode(convertToTexture(beautyNode), depthNode, velocityNode, camera));
