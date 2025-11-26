import * as THREE from "three/webgpu";
import { ProgressiveLightMap } from "three/addons/misc/ProgressiveLightMapGPU.js";

export interface LightmapSettings {
    /** Resolution of the lightmap texture (default: 1024) */
    lightMapRes?: number;
    /** Resolution of shadow maps for baking lights (default: 512) */
    shadowMapRes?: number;
    /** Number of directional lights for faster convergence (default: 4) */
    lightCount?: number;
    /** Blend window for accumulation (default: 200) */
    blendWindow?: number;
    /** Whether to blur edges (default: true) */
    blurEdges?: boolean;
    /** Radius of light position jittering (default: 50) */
    lightRadius?: number;
    /** Weight for ambient occlusion samples vs direct light (default: 0.5) */
    ambientWeight?: number;
}

const DEFAULT_SETTINGS: Required<LightmapSettings> = {
    lightMapRes: 1024,
    shadowMapRes: 512,
    lightCount: 4,
    blendWindow: 200,
    blurEdges: true,
    lightRadius: 50,
    ambientWeight: 0.5,
};

/**
 * Manages progressive lightmap baking for static geometry.
 * Designed to be chunking-ready: meshes are tracked in a registry
 * and lightmap updates can be paused/resumed.
 */
export class LightmapManager {
    private renderer: THREE.WebGPURenderer;
    private progressiveLightMap: ProgressiveLightMap | null = null;
    private settings: Required<LightmapSettings>;

    /** Meshes registered for lightmapping */
    private registeredMeshes: Map<string, THREE.Mesh> = new Map();

    /** Directional lights used for baking */
    private bakingLights: THREE.DirectionalLight[] = [];

    /** Origin point for directional light positioning */
    private lightOrigin: THREE.Vector3;

    /** Target for directional lights (usually scene center) */
    private lightTarget: THREE.Object3D;

    /** Whether lightmap accumulation is enabled */
    private _enabled: boolean = true;

    /** Whether the lightmap needs rebuilding (meshes added/removed) */
    private _dirty: boolean = false;

    /** Number of accumulation frames since last rebuild */
    private accumulationFrames: number = 0;

    /** Maximum frames to accumulate before auto-pausing (0 = never pause) */
    public maxAccumulationFrames: number = 0;

    constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, settings: LightmapSettings = {}) {
        this.renderer = renderer;
        this.settings = { ...DEFAULT_SETTINGS, ...settings };

        // Create light origin and target
        this.lightOrigin = new THREE.Vector3(60, 150, 100);
        this.lightTarget = new THREE.Object3D();
        this.lightTarget.position.set(0, 0, 0);
        scene.add(this.lightTarget);

        // Create baking lights
        this.createBakingLights(scene);
    }

    private createBakingLights(_scene: THREE.Scene): void {
        const { lightCount, shadowMapRes } = this.settings;

        for (let i = 0; i < lightCount; i++) {
            const light = new THREE.DirectionalLight(0xffffff, Math.PI / lightCount);
            light.name = `LightmapBakeLight_${i}`;
            light.position.set(200, 200, 200);
            light.castShadow = true;
            // Larger frustum to cover more of the scene
            light.shadow.camera.near = 10;
            light.shadow.camera.far = 1000;
            light.shadow.camera.right = 300;
            light.shadow.camera.left = -300;
            light.shadow.camera.top = 300;
            light.shadow.camera.bottom = -300;
            light.shadow.mapSize.width = shadowMapRes;
            light.shadow.mapSize.height = shadowMapRes;
            // Increased bias to reduce shadow acne on angled surfaces
            light.shadow.bias = -0.0001;
            light.shadow.normalBias = 0.02;
            light.target = this.lightTarget;

            this.bakingLights.push(light);
            // NOTE: Don't add to main scene - lights are only for lightmap baking
            // They get added to the internal scene via addObjectsToLightMap()
        }
    }

    /**
     * Register a mesh for lightmap baking.
     * The mesh must have uv attribute for lightmap UVs.
     * @param castShadow Whether this mesh should cast shadows (default: true)
     * @param receiveShadow Whether this mesh should receive shadows (default: true)
     */
    public registerMesh(
        id: string,
        mesh: THREE.Mesh,
        castShadow: boolean = true,
        receiveShadow: boolean = true
    ): void {
        // Check for uv attribute (required by ProgressiveLightMap)
        if (!mesh.geometry.hasAttribute("uv")) {
            console.warn(
                `LightmapManager: Mesh "${id}" does not have uv attribute. ` +
                `Lightmap will not work.`
            );
        }

        // Set shadow settings for proper lightmap baking
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;

        this.registeredMeshes.set(id, mesh);
        this._dirty = true;
    }

    /**
     * Unregister a mesh from lightmap baking.
     * Triggers an immediate rebuild to prevent stale references.
     */
    public unregisterMesh(id: string): void {
        if (this.registeredMeshes.has(id)) {
            this.registeredMeshes.delete(id);
            // Immediately rebuild to clear stale references in ProgressiveLightMap
            // This prevents errors when the old mesh is removed from the scene
            this.rebuild();
        }
    }

    /**
     * Mark the lightmap as needing a rebuild.
     * Call this when geometry changes.
     */
    public markDirty(): void {
        this._dirty = true;
    }

    /**
     * Rebuild the lightmap object list and reset accumulation.
     * Creates a fresh ProgressiveLightMap to clear any stale object references.
     */
    public rebuild(): void {
        // Dispose old progressive lightmap if it exists
        if (this.progressiveLightMap) {
            // Cast to any because dispose() exists but isn't in type definitions
            (this.progressiveLightMap as unknown as { dispose(): void }).dispose();
        }

        // Create a fresh ProgressiveLightMap to clear stale _lightMapContainers
        this.progressiveLightMap = new ProgressiveLightMap(
            this.renderer,
            this.settings.lightMapRes
        );

        const meshes = Array.from(this.registeredMeshes.values());
        
        // Include baking lights in the lightmap objects
        const lightmapObjects: THREE.Object3D[] = [...meshes, ...this.bakingLights];
        
        console.log(`[LightmapManager] Rebuilding with ${meshes.length} meshes and ${this.bakingLights.length} lights`);
        meshes.forEach(mesh => {
            const hasUV = mesh.geometry.hasAttribute("uv");
            // const hasNormal = mesh.geometry.hasAttribute("normal");
            // const matType = (mesh.material as THREE.Material).type;
            // console.log(`  Mesh ${i}: uv=${hasUV}, normal=${hasNormal}, castShadow=${mesh.castShadow}, receiveShadow=${mesh.receiveShadow}, material=${matType}`);
            
            // Debug: Check UV ranges
            if (hasUV) {
                const uvAttr = mesh.geometry.getAttribute("uv");
                let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
                for (let j = 0; j < uvAttr.count; j++) {
                    const u = uvAttr.getX(j);
                    const v = uvAttr.getY(j);
                    minU = Math.min(minU, u);
                    maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v);
                    maxV = Math.max(maxV, v);
                }
                // console.log(`    UV range: u=[${minU.toFixed(3)}, ${maxU.toFixed(3)}], v=[${minV.toFixed(3)}, ${maxV.toFixed(3)}]`);
            }
        });
        
        this.progressiveLightMap.addObjectsToLightMap(lightmapObjects);
        
        // Verify lightmap was applied to materials
        meshes.forEach(mesh => {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const geom = mesh.geometry;
            // const uvAttr = geom.getAttribute("uv");
            const uv1Attr = geom.getAttribute("uv1");
            // console.log(`  Mesh ${i}: lightMap=${mat.lightMap ? 'SET' : 'null'}, uv count=${uvAttr?.count}, uv1 count=${uv1Attr?.count}`);
            
            // Debug: Check uv1 ranges (the packed lightmap UVs)
            if (uv1Attr) {
                let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
                for (let j = 0; j < uv1Attr.count; j++) {
                    const u = uv1Attr.getX(j);
                    const v = uv1Attr.getY(j);
                    minU = Math.min(minU, u);
                    maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v);
                    maxV = Math.max(maxV, v);
                }
                // console.log(`    uv1 range: u=[${minU.toFixed(3)}, ${maxU.toFixed(3)}], v=[${minV.toFixed(3)}, ${maxV.toFixed(3)}]`);
            }
            
            // Boost lightmap intensity to make effect more visible
            mat.lightMapIntensity = 2.0;
        });
        
        // Show debug lightmap to see what's being baked
        this.progressiveLightMap.showDebugLightmap(true);
        
        this.accumulationFrames = 0;
        this._dirty = false;
    }

    /**
     * Update lightmap accumulation. Call this each frame.
     */
    public update(camera: THREE.Camera): void {
        // Rebuild if dirty
        if (this._dirty) {
            this.rebuild();
        }

        // Skip if disabled or auto-paused
        if (!this._enabled) {
            return;
        }

        if (this.maxAccumulationFrames > 0 && this.accumulationFrames >= this.maxAccumulationFrames) {
            return;
        }

        // Jitter light positions for soft shadows / ambient occlusion
        this.jitterLights();

        // Accumulate lightmap (skip if not yet built)
        if (this.progressiveLightMap) {
            this.progressiveLightMap.update(
                camera,
                this.settings.blendWindow,
                this.settings.blurEdges
            );
        }

        this.accumulationFrames++;
    }

    private jitterLights(): void {
        const { lightRadius, ambientWeight } = this.settings;

        for (const light of this.bakingLights) {
            if (Math.random() > ambientWeight) {
                // Sample from light origin with jitter
                light.position.set(
                    this.lightOrigin.x + (Math.random() - 0.5) * lightRadius,
                    this.lightOrigin.y + (Math.random() - 0.5) * lightRadius,
                    this.lightOrigin.z + (Math.random() - 0.5) * lightRadius
                );
            } else {
                // Uniform hemispherical distribution for ambient occlusion
                const lambda = Math.acos(2 * Math.random() - 1) - Math.PI / 2;
                const phi = 2 * Math.PI * Math.random();
                const radius = 300;

                light.position.set(
                    Math.cos(lambda) * Math.cos(phi) * radius + this.lightTarget.position.x,
                    Math.abs(Math.cos(lambda) * Math.sin(phi) * radius) + this.lightTarget.position.y + 20,
                    Math.sin(lambda) * radius + this.lightTarget.position.z
                );
            }
        }
    }

    /**
     * Set the light origin position for directional lighting.
     */
    public setLightOrigin(x: number, y: number, z: number): void {
        this.lightOrigin.set(x, y, z);
    }

    /**
     * Set the light target position (where lights point).
     */
    public setLightTarget(x: number, y: number, z: number): void {
        this.lightTarget.position.set(x, y, z);
    }

    /**
     * Enable or disable lightmap accumulation.
     */
    public set enabled(value: boolean) {
        this._enabled = value;
        if (value) {
            // Reset accumulation counter when re-enabled
            this.accumulationFrames = 0;
        }
    }

    public get enabled(): boolean {
        return this._enabled;
    }

    /**
     * Check if the lightmap is fully converged (reached max frames).
     */
    public get isConverged(): boolean {
        return this.maxAccumulationFrames > 0 && this.accumulationFrames >= this.maxAccumulationFrames;
    }

    /**
     * Get the current accumulation frame count.
     */
    public get frameCount(): number {
        return this.accumulationFrames;
    }

    /**
     * Reset accumulation and start fresh.
     */
    public resetAccumulation(): void {
        this.accumulationFrames = 0;
        this._dirty = true;
    }

    /**
     * Show or hide the debug lightmap view.
     */
    public showDebugLightmap(show: boolean): void {
        this.progressiveLightMap?.showDebugLightmap(show);
    }

    /**
     * Get all registered mesh IDs.
     */
    public getRegisteredMeshIds(): string[] {
        return Array.from(this.registeredMeshes.keys());
    }

    /**
     * Dispose of all resources.
     */
    public dispose(): void {
        // Dispose progressive lightmap
        if (this.progressiveLightMap) {
            // Cast to any because dispose() exists but isn't in type definitions
            (this.progressiveLightMap as unknown as { dispose(): void }).dispose();
            this.progressiveLightMap = null;
        }

        // Remove baking lights from scene
        for (const light of this.bakingLights) {
            light.parent?.remove(light);
            light.dispose();
        }
        this.bakingLights = [];

        // Remove light target
        this.lightTarget.parent?.remove(this.lightTarget);

        // Clear mesh registry
        this.registeredMeshes.clear();
    }
}
