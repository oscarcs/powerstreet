import {
    RenderTarget,
    Vector2,
    TempNode,
    QuadMesh,
    NodeMaterial,
    RendererUtils,
    MathUtils,
    PerspectiveCamera,
} from "three/webgpu";
import {
    clamp,
    normalize,
    reference,
    nodeObject,
    Fn,
    NodeUpdateType,
    uniform,
    vec4,
    passTexture,
    uv,
    logarithmicDepthToViewZ,
    viewZToPerspectiveDepth,
    getViewPosition,
    screenCoordinate,
    float,
    sub,
    fract,
    dot,
    vec2,
    rand,
    vec3,
    Loop,
    mul,
    PI,
    cos,
    sin,
    uint,
    cross,
    acos,
    sign,
    pow,
    luminance,
    If,
    max,
    abs,
    Break,
    sqrt,
    HALF_PI,
    div,
    ceil,
    shiftRight,
    convertToTexture,
    bool,
    getNormalFromDepth,
    interleavedGradientNoise,
} from "three/tsl";

const _quadMesh = new QuadMesh();
const _size = new Vector2();

const _temporalRotations = [60, 300, 180, 240, 120, 0];
const _spatialOffsets = [0, 0.5, 0.25, 0.75];

let _rendererState: any;

/**
 * Post processing node for applying Screen Space Global Illumination (SSGI) to a scene.
 * Modified version with enabled flag to skip computation when disabled.
 */
class SSGINode extends TempNode {
    static get type() {
        return "SSGINode";
    }

    beautyNode: any;
    depthNode: any;
    normalNode: any;

    updateBeforeType = NodeUpdateType.FRAME;

    sliceCount: any;
    stepCount: any;
    aoIntensity: any;
    giIntensity: any;
    radius: any;
    useScreenSpaceSampling: any;
    expFactor: any;
    thickness: any;
    useLinearThickness: any;
    backfaceLighting: any;
    useTemporalFiltering = true;

    private _resolution: any;
    private _halfProjScale: any;
    private _temporalDirection: any;
    private _temporalOffset: any;
    private _cameraProjectionMatrixInverse: any;
    private _cameraNear: any;
    private _cameraFar: any;
    private _camera: PerspectiveCamera;
    private _ssgiRenderTarget: RenderTarget;
    private _material: NodeMaterial;
    private _textureNode: any;
    private _enabled = true;

    constructor(
        beautyNode: any,
        depthNode: any,
        normalNode: any,
        camera: PerspectiveCamera,
    ) {
        super("vec4");

        this.beautyNode = beautyNode;
        this.depthNode = depthNode;
        this.normalNode = normalNode;

        this.sliceCount = uniform(1, "uint");
        this.stepCount = uniform(12, "uint");
        this.aoIntensity = uniform(1, "float");
        this.giIntensity = uniform(10, "float");
        this.radius = uniform(12, "float");
        this.useScreenSpaceSampling = uniform(true, "bool");
        this.expFactor = uniform(2, "float");
        this.thickness = uniform(1, "float");
        this.useLinearThickness = uniform(false, "bool");
        this.backfaceLighting = uniform(0, "float");

        this._resolution = uniform(new Vector2());
        this._halfProjScale = uniform(1);
        this._temporalDirection = uniform(0);
        this._temporalOffset = uniform(0);
        this._cameraProjectionMatrixInverse = uniform(camera.projectionMatrixInverse);
        this._cameraNear = reference("near", "float", camera);
        this._cameraFar = reference("far", "float", camera);
        this._camera = camera;

        this._ssgiRenderTarget = new RenderTarget(1, 1, { depthBuffer: false });
        this._ssgiRenderTarget.texture.name = "SSGI";

        this._material = new NodeMaterial();
        this._material.name = "SSGI";

        this._textureNode = passTexture(this as any, this._ssgiRenderTarget.texture);
    }

    /**
     * Enable or disable SSGI computation.
     * When disabled, updateBefore() skips rendering to save performance.
     */
    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
    }

    isEnabled(): boolean {
        return this._enabled;
    }

    getTextureNode() {
        return this._textureNode;
    }

    setSize(width: number, height: number) {
        this._resolution.value.set(width, height);
        this._ssgiRenderTarget.setSize(width, height);

        this._halfProjScale.value =
            (height / (Math.tan(this._camera.fov * MathUtils.DEG2RAD * 0.5) * 2)) * 0.5;
    }

    updateBefore(frame: any) {
        // Skip computation when disabled
        if (!this._enabled) {
            return;
        }

        const { renderer } = frame;

        _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

        const size = renderer.getDrawingBufferSize(_size);
        this.setSize(size.width, size.height);

        // update temporal uniforms
        if (this.useTemporalFiltering === true) {
            const frameId = frame.frameId;

            this._temporalDirection.value = _temporalRotations[frameId % 6] / 360;
            this._temporalOffset.value = _spatialOffsets[frameId % 4];
        } else {
            this._temporalDirection.value = 1;
            this._temporalOffset.value = 1;
        }

        _quadMesh.material = this._material;
        (_quadMesh as any).name = "SSGI";

        // clear
        renderer.setClearColor(0x000000, 1);

        // gi
        renderer.setRenderTarget(this._ssgiRenderTarget);
        _quadMesh.render(renderer);

        // restore
        RendererUtils.restoreRendererState(renderer, _rendererState);
    }

    setup(builder: any) {
        const uvNode = uv();
        const MAX_RAY = uint(32);
        const globalOccludedBitfield = uint(0);

        // Popcount / bit count function
        const bitCount = Fn(([value]: any[]) => {
            const v = uint(value).toVar();
            v.assign(v.sub(v.shiftRight(uint(1)).bitAnd(uint(0x55555555))));
            v.assign(v.bitAnd(uint(0x33333333)).add(v.shiftRight(uint(2)).bitAnd(uint(0x33333333))));
            return v.add(v.shiftRight(uint(4))).bitAnd(uint(0x0f0f0f0f)).mul(uint(0x01010101)).shiftRight(uint(24));
        }).setLayout({
            name: "bitCount",
            type: "uint",
            inputs: [{ name: "value", type: "uint" }],
        });

        const sampleDepth = (uvCoord: any) => {
            const depth = this.depthNode.sample(uvCoord).r;

            if (builder.renderer.logarithmicDepthBuffer === true) {
                const viewZ = logarithmicDepthToViewZ(depth, this._cameraNear, this._cameraFar);
                return viewZToPerspectiveDepth(viewZ, this._cameraNear, this._cameraFar);
            }

            return depth;
        };

        const sampleNormal = (uvCoord: any) =>
            this.normalNode !== null
                ? this.normalNode.sample(uvCoord).rgb.normalize()
                : getNormalFromDepth(
                      uvCoord,
                      this.depthNode.value,
                      this._cameraProjectionMatrixInverse,
                  );

        const sampleBeauty = (uvCoord: any) => this.beautyNode.sample(uvCoord);

        const spatialOffsets = Fn(([position]: any[]) => {
            return float(0.25).mul(sub(position.y, position.x).bitAnd(3));
        }).setLayout({
            name: "spatialOffsets",
            type: "float",
            inputs: [{ name: "position", type: "vec2" }],
        });

        const GTAOFastAcos = Fn(([value]: any[]) => {
            const outVal = abs(value).mul(float(-0.156583)).add(HALF_PI);
            outVal.mulAssign(sqrt(abs(value).oneMinus()));

            const x = value.x.greaterThanEqual(0).select(outVal.x, PI.sub(outVal.x));
            const y = value.y.greaterThanEqual(0).select(outVal.y, PI.sub(outVal.y));

            return vec2(x, y);
        }).setLayout({
            name: "GTAOFastAcos",
            type: "vec2",
            inputs: [{ name: "value", type: "vec2" }],
        });

        const horizonSampling = Fn(
            ([
                directionIsRight,
                RADIUS,
                viewPosition,
                slideDirTexelSize,
                initialRayStep,
                uvNode,
                viewDir,
                viewNormal,
                n,
            ]: any[]) => {
                const STEP_COUNT = this.stepCount.toConst();
                const EXP_FACTOR = this.expFactor.toConst();
                const THICKNESS = this.thickness.toConst();
                const BACKFACE_LIGHTING = this.backfaceLighting.toConst();

                const stepRadius = float(0);

                If(this.useScreenSpaceSampling.equal(true), () => {
                    stepRadius.assign(RADIUS.mul(this._resolution.x.div(2)).div(float(16)));
                }).Else(() => {
                    stepRadius.assign(
                        max(
                            RADIUS.mul(this._halfProjScale).div(viewPosition.z.negate()),
                            float(STEP_COUNT),
                        ),
                    );
                });

                stepRadius.divAssign(float(STEP_COUNT).add(1));
                const radiusVS = max(1, float(STEP_COUNT.sub(1))).mul(stepRadius);
                const uvDirection = directionIsRight
                    .equal(true)
                    .select(vec2(1, -1), vec2(-1, 1));
                const samplingDirection = directionIsRight.equal(true).select(1, -1);

                const color = vec3(0);

                const lastSampleViewPosition = vec3(viewPosition).toVar();

                Loop(
                    { start: uint(0), end: STEP_COUNT, type: "uint", condition: "<" },
                    ({ i }: { i: any }) => {
                        const offset = pow(
                            abs(mul(stepRadius, float(i).add(initialRayStep)).div(radiusVS)),
                            EXP_FACTOR,
                        )
                            .mul(radiusVS)
                            .toConst();
                        const uvOffset = slideDirTexelSize
                            .mul(max(offset, float(i).add(1)))
                            .toConst();
                        const sampleUV = uvNode.add(uvOffset.mul(uvDirection)).toConst();

                        If(
                            sampleUV.x
                                .lessThanEqual(0)
                                .or(sampleUV.y.lessThanEqual(0))
                                .or(sampleUV.x.greaterThanEqual(1))
                                .or(sampleUV.y.greaterThanEqual(1)),
                            () => {
                                Break();
                            },
                        );

                        const sampleViewPosition = getViewPosition(
                            sampleUV,
                            sampleDepth(sampleUV),
                            this._cameraProjectionMatrixInverse,
                        ).toConst();
                        const pixelToSample = sampleViewPosition
                            .sub(viewPosition)
                            .normalize()
                            .toConst();
                        const linearThicknessMultiplier = this.useLinearThickness
                            .equal(true)
                            .select(
                                sampleViewPosition.z.negate().div(this._cameraFar).clamp().mul(100),
                                float(1),
                            );
                        const pixelToSampleBackface = normalize(
                            sampleViewPosition
                                .sub(linearThicknessMultiplier.mul(viewDir).mul(THICKNESS))
                                .sub(viewPosition),
                        );

                        let frontBackHorizon: any = vec2(
                            dot(pixelToSample, viewDir),
                            dot(pixelToSampleBackface, viewDir),
                        );
                        frontBackHorizon = GTAOFastAcos(clamp(frontBackHorizon, -1, 1));
                        frontBackHorizon = clamp(
                            div(
                                mul(samplingDirection, frontBackHorizon.negate()).sub(
                                    n.sub(HALF_PI),
                                ),
                                PI,
                            ),
                        );
                        frontBackHorizon = directionIsRight
                            .equal(true)
                            .select(frontBackHorizon.yx, frontBackHorizon.xy);

                        const minHorizon = frontBackHorizon.x.toConst();
                        const maxHorizon = frontBackHorizon.y.toConst();

                        const startHorizonInt = uint(frontBackHorizon.mul(float(MAX_RAY))).toConst();
                        const angleHorizonInt = uint(
                            ceil(maxHorizon.sub(minHorizon).mul(float(MAX_RAY))),
                        ).toConst();
                        const angleHorizonBitfield = angleHorizonInt
                            .greaterThan(uint(0))
                            .select(
                                uint(
                                    shiftRight(
                                        uint(0xffffffff),
                                        uint(32).sub(MAX_RAY).add(MAX_RAY.sub(angleHorizonInt)),
                                    ),
                                ),
                                uint(0),
                            )
                            .toConst();
                        let currentOccludedBitfield: any =
                            angleHorizonBitfield.shiftLeft(startHorizonInt);
                        currentOccludedBitfield = currentOccludedBitfield.bitAnd(
                            (globalOccludedBitfield as any).bitNot(),
                        );

                        globalOccludedBitfield.assign(
                            globalOccludedBitfield.bitOr(currentOccludedBitfield),
                        );
                        const numOccludedZones = bitCount(currentOccludedBitfield);

                        If(numOccludedZones.greaterThan(0), () => {
                            const lightColor = sampleBeauty(sampleUV);

                            If(luminance(lightColor).greaterThan(0.001), () => {
                                const lightDirectionVS = normalize(pixelToSample);
                                const normalDotLightDirection = clamp(
                                    dot(viewNormal, lightDirectionVS),
                                );

                                If(normalDotLightDirection.greaterThan(0.001), () => {
                                    const lightNormalVS = sampleNormal(sampleUV);

                                    let lightNormalDotLightDirection = dot(
                                        lightNormalVS,
                                        lightDirectionVS.negate(),
                                    );

                                    const d = sign(lightNormalDotLightDirection)
                                        .lessThan(0)
                                        .select(
                                            abs(lightNormalDotLightDirection).mul(BACKFACE_LIGHTING),
                                            abs(lightNormalDotLightDirection),
                                        );
                                    lightNormalDotLightDirection = BACKFACE_LIGHTING.greaterThan(0)
                                        .and(dot(lightNormalVS, viewDir).greaterThan(0))
                                        .select(d, clamp(lightNormalDotLightDirection));

                                    color.rgb.addAssign(
                                        float(numOccludedZones)
                                            .div(float(MAX_RAY))
                                            .mul(lightColor)
                                            .mul(normalDotLightDirection)
                                            .mul(lightNormalDotLightDirection),
                                    );
                                });
                            });
                        });

                        lastSampleViewPosition.assign(sampleViewPosition);
                    },
                );

                return vec3(color);
            },
        );

        const gi = Fn(() => {
            const depth = sampleDepth(uvNode).toVar();

            depth.greaterThanEqual(1.0).discard();

            const viewPosition = getViewPosition(
                uvNode,
                depth,
                this._cameraProjectionMatrixInverse,
            ).toVar();
            const viewNormal = sampleNormal(uvNode).toVar();
            const viewDir = normalize(viewPosition.xyz.negate()).toVar();

            const noiseOffset = spatialOffsets(screenCoordinate);
            const noiseDirection = interleavedGradientNoise(screenCoordinate);
            const noiseJitterIdx = this._temporalDirection.mul(0.02);
            const initialRayStep = fract(noiseOffset.add(this._temporalOffset)).add(
                rand(uvNode.add(noiseJitterIdx).mul(2).sub(1)),
            );

            const ao = float(0);
            const color = vec3(0);

            const ROTATION_COUNT = this.sliceCount.toConst();
            const AO_INTENSITY = this.aoIntensity.toConst();
            const GI_INTENSITY = this.giIntensity.toConst();
            const RADIUS = this.radius.toConst();

            Loop(
                { start: uint(0), end: ROTATION_COUNT, type: "uint", condition: "<" },
                ({ i }: { i: any }) => {
                    const rotationAngle = mul(
                        float(i).add(noiseDirection).add(this._temporalDirection),
                        PI.div(float(ROTATION_COUNT)),
                    ).toConst();
                    const sliceDir = vec3(vec2(cos(rotationAngle), sin(rotationAngle)), 0).toConst();
                    const slideDirTexelSize = sliceDir.xy
                        .mul(float(1).div(this._resolution))
                        .toConst();

                    const planeNormal = normalize(cross(sliceDir, viewDir)).toConst();
                    const tangent = cross(viewDir, planeNormal).toConst();
                    const projectedNormal = viewNormal
                        .sub(planeNormal.mul(dot(viewNormal, planeNormal)))
                        .toConst();
                    const projectedNormalNormalized = normalize(projectedNormal).toConst();

                    const cos_n = clamp(dot(projectedNormalNormalized, viewDir), -1, 1).toConst();
                    const n = sign(dot(projectedNormal, tangent)).negate().mul(acos(cos_n)).toConst();

                    globalOccludedBitfield.assign(0);

                    color.addAssign(
                        horizonSampling(
                            bool(true),
                            RADIUS,
                            viewPosition,
                            slideDirTexelSize,
                            initialRayStep,
                            uvNode,
                            viewDir,
                            viewNormal,
                            n,
                        ),
                    );
                    color.addAssign(
                        horizonSampling(
                            bool(false),
                            RADIUS,
                            viewPosition,
                            slideDirTexelSize,
                            initialRayStep,
                            uvNode,
                            viewDir,
                            viewNormal,
                            n,
                        ),
                    );

                    ao.addAssign(float(bitCount(globalOccludedBitfield)).div(float(MAX_RAY)));
                },
            );

            ao.divAssign(float(ROTATION_COUNT));
            ao.assign(pow(ao.clamp().oneMinus(), AO_INTENSITY).clamp());

            color.divAssign(float(ROTATION_COUNT));
            color.mulAssign(GI_INTENSITY);

            // scale color based on luminance
            const maxLuminance = float(7).toConst();
            const currentLuminance = luminance(color);
            const scale = currentLuminance
                .greaterThan(maxLuminance)
                .select(maxLuminance.div(currentLuminance), float(1));
            color.mulAssign(scale);

            return vec4(color, ao);
        });

        this._material.fragmentNode = gi().context(builder.getSharedContext());
        this._material.needsUpdate = true;

        return this._textureNode;
    }

    dispose() {
        this._ssgiRenderTarget.dispose();
        this._material.dispose();
    }
}

export default SSGINode;

/**
 * TSL function for creating a SSGI effect.
 */
export const ssgi = (
    beautyNode: any,
    depthNode: any,
    normalNode: any,
    camera: PerspectiveCamera,
) => nodeObject(new SSGINode(convertToTexture(beautyNode), depthNode, normalNode, camera));
