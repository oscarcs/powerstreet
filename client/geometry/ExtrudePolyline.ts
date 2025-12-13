export type Vec2 = [number, number];

function vec2Create(): Vec2 {
    return [0, 0];
}

function vec2Clone(a: Vec2): Vec2 {
    return [a[0], a[1]];
}

function vec2Set(out: Vec2, x: number, y: number): Vec2 {
    out[0] = x;
    out[1] = y;
    return out;
}

function vec2Copy(out: Vec2, a: Vec2): Vec2 {
    out[0] = a[0];
    out[1] = a[1];
    return out;
}

function vec2Add(out: Vec2, a: Vec2, b: Vec2): Vec2 {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    return out;
}

function vec2Subtract(out: Vec2, a: Vec2, b: Vec2): Vec2 {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    return out;
}

function vec2ScaleAndAdd(out: Vec2, a: Vec2, b: Vec2, scale: number): Vec2 {
    out[0] = a[0] + b[0] * scale;
    out[1] = a[1] + b[1] * scale;
    return out;
}

function vec2Normalize(out: Vec2, a: Vec2): Vec2 {
    const x = a[0];
    const y = a[1];
    let len = x * x + y * y;
    if (len > 0) {
        len = 1 / Math.sqrt(len);
    }
    out[0] = x * len;
    out[1] = y * len;
    return out;
}

function vec2Dot(a: Vec2, b: Vec2): number {
    return a[0] * b[0] + a[1] * b[1];
}

const _miterTmp: Vec2 = [0, 0];

/**
 * Compute the miter vector and its length for a join between two line segments.
 */
function computeMiter(
    tangent: Vec2,
    miter: Vec2,
    lineA: Vec2,
    lineB: Vec2,
    halfThick: number,
): number {
    // Get tangent line (average of the two directions)
    vec2Add(tangent, lineA, lineB);
    vec2Normalize(tangent, tangent);

    // Get miter as a unit vector (perpendicular to tangent)
    vec2Set(miter, -tangent[1], tangent[0]);
    vec2Set(_miterTmp, -lineA[1], lineA[0]);

    // Get the necessary length of our miter
    return halfThick / vec2Dot(miter, _miterTmp);
}

/**
 * Get the perpendicular (normal) of a direction vector.
 */
function normal(out: Vec2, dir: Vec2): Vec2 {
    vec2Set(out, -dir[1], dir[0]);
    return out;
}

/**
 * Get the unit direction from point b to point a.
 */
function direction(out: Vec2, a: Vec2, b: Vec2): Vec2 {
    vec2Subtract(out, a, b);
    vec2Normalize(out, out);
    return out;
}

export interface StrokeMesh {
    /** Flat array of 3D positions [x, y, z, x, y, z, ...] for Three.js BufferGeometry */
    positions: Float32Array;
    /** Triangle indices for Three.js BufferGeometry */
    indices: Uint32Array;
}

export type CapType = "butt" | "square";
export type JoinType = "miter" | "bevel";

export interface StrokeOptions {
    /** Line thickness in world units. Default: 1 */
    thickness?: number;
    /** Cap style at line endpoints. Default: 'butt' */
    cap?: CapType;
    /** Join style at corners. Default: 'miter' */
    join?: JoinType;
    /** Miter limit (ratio) before falling back to bevel. Default: 10 */
    miterLimit?: number;
}

interface SimplicialComplex {
    positions: Vec2[];
    cells: [number, number, number][];
}

const _tmp: Vec2 = vec2Create();
const _capEnd: Vec2 = vec2Create();
const _lineA: Vec2 = vec2Create();
const _lineB: Vec2 = vec2Create();
const _tangent: Vec2 = vec2Create();
const _miter: Vec2 = vec2Create();

/**
 * Extrudes a 2D polyline with a given line thickness and the desired join/cap types.
 * Produces a triangulated mesh suitable for Three.js BufferGeometry.
 *
 * Input coordinates are 2D [x, y] which map to Three.js [x, z] (xz-plane at y=0).
 *
 * @example
 * const polyline: Vec2[] = [[25, 25], [15, 60]];
 * const extruder = new ExtrudePolyline({
 *     thickness: 20,
 *     cap: 'square',
 *     join: 'bevel',
 *     miterLimit: 10
 * });
 * const mesh = extruder.build(polyline);
 * // mesh.positions: Float32Array of [x, y, z] vertices (y = 0)
 * // mesh.indices: Uint32Array of triangle indices
 */
export class ExtrudePolyline {
    public miterLimit: number;
    public thickness: number;
    public join: JoinType;
    public cap: CapType;

    private _normal: Vec2 | null = null;
    private _lastFlip: number = -1;
    private _started: boolean = false;

    constructor(options: StrokeOptions = {}) {
        this.miterLimit = options.miterLimit ?? 10;
        this.thickness = options.thickness ?? 1;
        this.join = options.join ?? "miter";
        this.cap = options.cap ?? "butt";
    }

    /**
     * Override this method to provide variable thickness along the polyline.
     */
    public mapThickness(_point: Vec2, _index: number, _points: Vec2[]): number {
        return this.thickness;
    }

    /**
     * Build a triangle mesh from a 2D polyline.
     *
     * Input: Array of [x, y] coordinates (2D polyline)
     * Output: StrokeMesh with 3D positions (x maps to x, y maps to z, output y = 0)
     */
    public build(points: Vec2[]): StrokeMesh {
        const complex: SimplicialComplex = {
            positions: [],
            cells: [],
        };

        if (points.length <= 1) {
            return {
                positions: new Float32Array(0),
                indices: new Uint32Array(0),
            };
        }

        const total = points.length;

        // Clear flags
        this._lastFlip = -1;
        this._started = false;
        this._normal = null;

        // Join each segment
        for (let i = 1, count = 0; i < total; i++) {
            const last = points[i - 1];
            const cur = points[i];
            const next = i < points.length - 1 ? points[i + 1] : null;
            const thickness = this.mapThickness(cur, i, points);
            const amt = this._seg(complex, count, last, cur, next, thickness / 2);
            count += amt;
        }

        return this._toThreeJSMesh(complex);
    }

    /**
     * Convert simplicial complex to Three.js-compatible mesh data.
     * Maps 2D [x, y] to 3D [x, 0, z] (xz-plane).
     */
    private _toThreeJSMesh(complex: SimplicialComplex): StrokeMesh {
        const positions = new Float32Array(complex.positions.length * 3);
        for (let i = 0; i < complex.positions.length; i++) {
            const pos = complex.positions[i];
            positions[i * 3 + 0] = pos[0]; // x -> x
            positions[i * 3 + 1] = 0; // y = 0 (flat on xz plane)
            positions[i * 3 + 2] = pos[1]; // y -> z
        }

        const indices = new Uint32Array(complex.cells.length * 3);
        for (let i = 0; i < complex.cells.length; i++) {
            const cell = complex.cells[i];
            indices[i * 3 + 0] = cell[0];
            indices[i * 3 + 1] = cell[1];
            indices[i * 3 + 2] = cell[2];
        }

        return { positions, indices };
    }

    /**
     * Process a single segment of the polyline.
     */
    private _seg(
        complex: SimplicialComplex,
        index: number,
        last: Vec2,
        cur: Vec2,
        next: Vec2 | null,
        halfThick: number,
    ): number {
        let count = 0;
        const cells = complex.cells;
        const positions = complex.positions;
        const capSquare = this.cap === "square";
        const joinBevel = this.join === "bevel";

        // Get unit direction of line
        direction(_lineA, cur, last);

        // If we don't yet have a normal from previous join, compute based on line start - end
        if (!this._normal) {
            this._normal = vec2Create();
            normal(this._normal, _lineA);
        }

        // If we haven't started yet, add the first two points
        if (!this._started) {
            this._started = true;

            // If the end cap is type square, we can just push the verts out a bit
            let startPoint = last;
            if (capSquare) {
                vec2ScaleAndAdd(_capEnd, last, _lineA, -halfThick);
                startPoint = _capEnd;
            }

            this._extrusions(positions, startPoint, this._normal, halfThick);
        }

        cells.push([index + 0, index + 1, index + 2]);

        if (!next) {
            // No next segment, simple extrusion
            // Reset normal to finish cap
            normal(this._normal, _lineA);

            // Push square end cap out a bit
            let endPoint = cur;
            if (capSquare) {
                vec2ScaleAndAdd(_capEnd, cur, _lineA, halfThick);
                endPoint = _capEnd;
            }

            this._extrusions(positions, endPoint, this._normal, halfThick);
            cells.push(
                this._lastFlip === 1
                    ? [index, index + 2, index + 3]
                    : [index + 2, index + 1, index + 3],
            );

            count += 2;
        } else {
            // We have a next segment, start with miter
            // Get unit dir of next line
            direction(_lineB, next, cur);

            // Stores tangent & miter
            const miterLen = computeMiter(_tangent, _miter, _lineA, _lineB, halfThick);

            // Get orientation
            let flip = vec2Dot(_tangent, this._normal) < 0 ? -1 : 1;

            let bevel = joinBevel;
            if (!bevel && this.join === "miter") {
                const limit = miterLen / halfThick;
                if (limit > this.miterLimit) {
                    bevel = true;
                }
            }

            if (bevel) {
                // Next two points in our first segment
                vec2ScaleAndAdd(_tmp, cur, this._normal, -halfThick * flip);
                positions.push(vec2Clone(_tmp));
                vec2ScaleAndAdd(_tmp, cur, _miter, miterLen * flip);
                positions.push(vec2Clone(_tmp));

                cells.push(
                    this._lastFlip !== -flip
                        ? [index, index + 2, index + 3]
                        : [index + 2, index + 1, index + 3],
                );

                // Now add the bevel triangle
                cells.push([index + 2, index + 3, index + 4]);

                normal(_tmp, _lineB);
                vec2Copy(this._normal, _tmp); // Store normal for next round

                vec2ScaleAndAdd(_tmp, cur, _tmp, -halfThick * flip);
                positions.push(vec2Clone(_tmp));

                // The miter is now the normal for our next join
                count += 3;
            } else {
                // Miter join
                // Next two points for our miter join
                this._extrusions(positions, cur, _miter, miterLen);
                cells.push(
                    this._lastFlip === 1
                        ? [index, index + 2, index + 3]
                        : [index + 2, index + 1, index + 3],
                );

                flip = -1;

                // The miter is now the normal for our next join
                vec2Copy(this._normal, _miter);
                count += 2;
            }
            this._lastFlip = flip;
        }
        return count;
    }

    /**
     * Add two extruded points along the normal at the given position.
     */
    private _extrusions(positions: Vec2[], point: Vec2, normalVec: Vec2, scale: number): void {
        // Next two points to end our segment
        vec2ScaleAndAdd(_tmp, point, normalVec, -scale);
        positions.push(vec2Clone(_tmp));

        vec2ScaleAndAdd(_tmp, point, normalVec, scale);
        positions.push(vec2Clone(_tmp));
    }
}

export default ExtrudePolyline;