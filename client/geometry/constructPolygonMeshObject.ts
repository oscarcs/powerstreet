import { BufferAttribute, MathUtils, Mesh, ShapeUtils, Vector2, Vector3 } from "three";
import {
    correctPolygonWinding,
    dedupePolygonPoints,
    getPolygonBounds,
    splitPolygon,
} from "./PolygonUtils";
import { resampleLine } from "./GeoJSONShapeUtils";
import { getLoopEdges, triangulate } from "./triangulate";
import { getCenter, offsetPoints, transformToEllipsoid } from "./FlatVertexBufferUtils.js";
import type {
    Coordinate,
    Edge,
    PolygonCoords,
    PolygonMeshOptions,
    ResampleMode,
    TriangulationResult,
} from "./types";

/** UV scale for lightmap projection (units per UV) */
const LIGHTMAP_UV_SCALE = 10;

const _vec = new Vector3();
const _dir1 = new Vector3();
const _dir2 = new Vector3();
const _min = new Vector3();
const _max = new Vector3();

interface SegmentInfo {
    point: Coordinate;
    slope: number;
    minx: number;
    maxx: number;
    miny: number;
    maxy: number;
}

function isPointOnPolygonEdge(segmentInfo: SegmentInfo[], x: number, y: number): boolean {
    for (let i = 0; i < segmentInfo.length; i++) {
        const { minx, maxx, miny, maxy, slope, point } = segmentInfo[i];
        if (x < minx || x > maxx || y < miny || y > maxy) {
            continue;
        }

        const dx1 = x - point[0];
        const dy1 = y - point[1];
        if (slope === dy1 / dx1) {
            return true;
        }
    }

    return false;
}

function getInnerPoints(
    polygon: PolygonCoords,
    resolution: number,
    mode: ResampleMode = "grid",
): Coordinate[] {
    getPolygonBounds(polygon, _min, _max);

    const startX = Math.sign(_min.x) * Math.ceil(Math.abs(_min.x / resolution)) * resolution;
    const startY = Math.sign(_min.y) * Math.ceil(Math.abs(_min.y / resolution)) * resolution;
    const z = (_max.z + _min.z) * 0.5;
    const dimension = polygon[0][0].length;

    if (startX > _max.x && startY > _max.y) {
        return [];
    }

    const segmentInfo = polygon.flatMap((loop) => {
        const res: SegmentInfo[] = [];
        for (let i = 0; i < loop.length; i++) {
            const ni = (i + 1) % loop.length;
            const c0 = loop[i];
            const c1 = loop[ni];

            const [cx0, cy0] = c0;
            const [cx1, cy1] = c1;
            const dx0 = cx1 - cx0;
            const dy0 = cy1 - cy0;
            const slope = dy0 / dx0;

            const minx = Math.min(cx0, cx1);
            const maxx = Math.max(cx0, cx1);
            const miny = Math.min(cy0, cy1);
            const maxy = Math.max(cy0, cy1);

            res.push({
                point: c0,
                slope,
                minx,
                maxx,
                miny,
                maxy,
            });
        }

        return res;
    });

    const result: Coordinate[] = [];
    for (let y = startY; y < _max.y; y += resolution) {
        const xScalar = mode === "grid" ? 1 : Math.sin(Math.PI / 2 + MathUtils.DEG2RAD * y);
        const xStride = resolution / xScalar;
        const alignedStartX = Math.sign(_min.x) * Math.ceil(Math.abs(_min.x / xStride)) * xStride;
        for (let x = alignedStartX; x < _max.x; x += resolution / xScalar) {
            if (!isPointOnPolygonEdge(segmentInfo, x, y)) {
                result.push(dimension === 2 ? [x, y] : [x, y, z]);
            }
        }
    }

    return result;
}

function addFaceNormals(index: number, posArray: number[], normalArray: Float32Array): void {
    _vec.fromArray(posArray, index);
    _dir1.fromArray(posArray, index + 3).sub(_vec);
    _dir2.fromArray(posArray, index + 6).sub(_vec);

    _vec.crossVectors(_dir1, _dir2).normalize();
    _vec.toArray(normalArray, index);
    _vec.toArray(normalArray, index + 3);
    _vec.toArray(normalArray, index + 6);
}

/**
 * Normalize a section of the UV array to fit within the specified bounds.
 * This prevents UV overlap between different face types.
 */
function normalizeUVSection(
    uvArray: Float32Array,
    startIndex: number,
    endIndex: number,
    minU: number,
    maxU: number,
    minV: number,
    maxV: number
): void {
    if (startIndex >= endIndex) return;
    
    // Find the current bounds of this section
    let srcMinU = Infinity, srcMaxU = -Infinity;
    let srcMinV = Infinity, srcMaxV = -Infinity;
    for (let i = startIndex; i < endIndex; i += 2) {
        srcMinU = Math.min(srcMinU, uvArray[i]);
        srcMaxU = Math.max(srcMaxU, uvArray[i]);
        srcMinV = Math.min(srcMinV, uvArray[i + 1]);
        srcMaxV = Math.max(srcMaxV, uvArray[i + 1]);
    }
    
    const srcRangeU = srcMaxU - srcMinU || 1;
    const srcRangeV = srcMaxV - srcMinV || 1;
    const dstRangeU = maxU - minU;
    const dstRangeV = maxV - minV;
    
    // Remap UVs to target bounds
    for (let i = startIndex; i < endIndex; i += 2) {
        uvArray[i] = minU + ((uvArray[i] - srcMinU) / srcRangeU) * dstRangeU;
        uvArray[i + 1] = minV + ((uvArray[i + 1] - srcMinV) / srcRangeV) * dstRangeV;
    }
}

export function constructPolygonMeshObject(
    polygons: PolygonCoords[],
    options: PolygonMeshOptions = {},
): Mesh {
    const {
        thickness = 0,
        offset = 0,
        flat = false,
        ellipsoid = null,
        resolution = null,
        detectSelfIntersection = true,
        altitudeScale = 1,
        useEarcut = false,
        groups = null,
    } = options;

    let cleanedPolygons: PolygonCoords[] = polygons.map((polygon) =>
        polygon.map((loop) => loop.map((coord) => [...coord] as Coordinate)),
    );

    if (detectSelfIntersection) {
        cleanedPolygons = cleanedPolygons
            .map((polygon) => dedupePolygonPoints(polygon))
            .filter((polygon) => polygon.length !== 0)
            .flatMap((polygon) => splitPolygon(polygon));
    }

    cleanedPolygons = cleanedPolygons.map((polygon) => correctPolygonWinding(polygon));

    const triangulations: TriangulationResult[] = cleanedPolygons.map((polygon) => {
        let workingPolygon: PolygonCoords = polygon.map((loop) =>
            loop.map((coord) => [...coord] as Coordinate),
        );

        let innerPoints: Coordinate[] = [];
        if (resolution !== null) {
            const resampleMode: ResampleMode = ellipsoid ? "ellipsoid" : "grid";
            innerPoints = useEarcut ? [] : getInnerPoints(workingPolygon, resolution, resampleMode);

            workingPolygon = workingPolygon.map((loop) =>
                resampleLine(loop, resolution, resampleMode),
            );
        }

        workingPolygon.forEach((loop) => {
            loop.pop();
        });

        const [contour, ...holes] = workingPolygon;
        if (!contour) {
            return { indices: [], edges: [], points: [] };
        }

        if (useEarcut) {
            const indices = ShapeUtils.triangulateShape(
                contour.map((c) => new Vector2(c[0], c[1])),
                holes.map((hole) => hole.map((c) => new Vector2(c[0], c[1]))),
            )
                .flatMap((tri) => tri)
                .reverse();

            let offsetIndex = 0;
            const edges: Edge[] = [];
            getLoopEdges(contour, offsetIndex, edges);
            offsetIndex += contour.length;

            holes.forEach((hole) => {
                getLoopEdges(hole, offsetIndex, edges);
                offsetIndex += hole.length;
            });

            return {
                points: [...contour, ...holes.flatMap((hole) => hole)] as Coordinate[],
                indices,
                edges,
            };
        }

        return triangulate(contour, holes, innerPoints);
    });

    let capVertices = 0;
    let edgeVertices = 0;
    const groupCapVertices: number[] = [];
    const groupEdgeVertices: number[] = [];
    triangulations.forEach(({ indices, edges }) => {
        capVertices += indices.length;
        edgeVertices += edges.length * 2 * 3;

        groupCapVertices.push(indices.length);
        groupEdgeVertices.push(edges.length * 2 * 3);
    });

    const totalVerts = thickness === 0 ? capVertices : 2 * capVertices + edgeVertices;
    const posArray: number[] = new Array(totalVerts * 3);
    const normalArray = new Float32Array(totalVerts * 3);
    const uvArray = new Float32Array(totalVerts * 2); // For lightmap UVs
    let topOffset = 0;
    let bottomOffset = capVertices * 3;
    let sideOffset = capVertices * 2 * 3;
    let uvTopOffset = 0;
    let uvBottomOffset = capVertices * 2;
    let uvSideOffset = capVertices * 2 * 2;
    triangulations.forEach(({ indices, points, edges }) => {
        const botHeight = offset;
        const topHeight = offset + thickness;

        for (let i = 0; i < indices.length; i += 3) {
            addPointWithUV(indices[i + 2], topHeight, topOffset + 0, uvTopOffset + 0);
            addPointWithUV(indices[i + 1], topHeight, topOffset + 3, uvTopOffset + 2);
            addPointWithUV(indices[i + 0], topHeight, topOffset + 6, uvTopOffset + 4);
            topOffset += 9;
            uvTopOffset += 6;

            if (thickness > 0) {
                addPointWithUV(indices[i + 0], botHeight, bottomOffset + 0, uvBottomOffset + 0);
                addPointWithUV(indices[i + 1], botHeight, bottomOffset + 3, uvBottomOffset + 2);
                addPointWithUV(indices[i + 2], botHeight, bottomOffset + 6, uvBottomOffset + 4);
                bottomOffset += 9;
                uvBottomOffset += 6;
            }
        }

        if (thickness > 0) {
            // Track cumulative edge length for UV mapping
            let cumulativeLength = 0;
            let totalEdgeLength = 0;
            
            // First pass: calculate total edge length
            for (let i = 0; i < edges.length; i++) {
                const edge = edges[i];
                const p0 = points[edge[0]];
                const p1 = points[edge[1]];
                const dx = p1[0] - p0[0];
                const dy = p1[1] - p0[1];
                totalEdgeLength += Math.sqrt(dx * dx + dy * dy);
            }
            
            // Second pass: generate side faces with proper UVs
            for (let i = 0; i < edges.length; i++) {
                const edge = edges[i];
                const i0 = edge[0];
                const i1 = edge[1];
                
                const p0 = points[i0];
                const p1 = points[i1];
                const dx = p1[0] - p0[0];
                const dy = p1[1] - p0[1];
                const edgeLength = Math.sqrt(dx * dx + dy * dy);
                
                // Calculate UV coordinates for this quad
                // U: along the edge (0 to edgeLength/totalEdgeLength)
                // V: 0 at bottom, 1 at top
                const u0 = cumulativeLength / totalEdgeLength;
                const u1 = (cumulativeLength + edgeLength) / totalEdgeLength;
                cumulativeLength += edgeLength;
                
                // Add position and UV for each vertex of the two triangles
                // Triangle 1: bottom-left, top-left, bottom-right
                addSidePoint(i0, botHeight, sideOffset + 0, uvSideOffset + 0, u0, 0);
                addSidePoint(i0, topHeight, sideOffset + 3, uvSideOffset + 2, u0, 1);
                addSidePoint(i1, botHeight, sideOffset + 6, uvSideOffset + 4, u1, 0);
                sideOffset += 9;
                uvSideOffset += 6;
                
                // Triangle 2: bottom-right, top-left, top-right
                addSidePoint(i1, botHeight, sideOffset + 0, uvSideOffset + 0, u1, 0);
                addSidePoint(i0, topHeight, sideOffset + 3, uvSideOffset + 2, u0, 1);
                addSidePoint(i1, topHeight, sideOffset + 6, uvSideOffset + 4, u1, 1);
                sideOffset += 9;
                uvSideOffset += 6;
            }
        }
        
        function addSidePoint(
            index: number,
            zOffset: number,
            posOffset: number,
            uvOffset: number,
            u: number,
            v: number
        ): void {
            const point = points[index];
            const z = flat ? 0 : (point[2] ?? 0);
            posArray[posOffset + 0] = point[0];
            posArray[posOffset + 1] = point[1];
            posArray[posOffset + 2] = z * altitudeScale + zOffset;
            
            // Write UV directly - will be normalized later
            uvArray[uvOffset + 0] = u;
            uvArray[uvOffset + 1] = v;
        }

        function addPointWithUV(
            index: number,
            zOffset: number,
            posOffset: number,
            uvOffset: number
        ): void {
            const point = points[index];
            const z = flat ? 0 : (point[2] ?? 0);
            const px = point[0];
            const py = point[1];
            const pz = z * altitudeScale + zOffset;

            posArray[posOffset + 0] = px;
            posArray[posOffset + 1] = py;
            posArray[posOffset + 2] = pz;

            // Generate UV using XY projection for top/bottom caps
            uvArray[uvOffset + 0] = px / LIGHTMAP_UV_SCALE;
            uvArray[uvOffset + 1] = py / LIGHTMAP_UV_SCALE;
        }
    });

    if (ellipsoid) {
        const bottomStart = capVertices * 3;
        for (let i = 0; i < capVertices * 3; i += 3) {
            const lon = posArray[i + 0] * MathUtils.DEG2RAD;
            const lat = posArray[i + 1] * MathUtils.DEG2RAD;
            ellipsoid.getCartographicToNormal(lat, lon, _vec);

            normalArray[i + 0] = _vec.x;
            normalArray[i + 1] = _vec.y;
            normalArray[i + 2] = _vec.z;

            if (thickness > 0) {
                const vert = i / 3;
                const triVertIndex = vert % 3;
                const reverseTriVertIndex = 2 - triVertIndex;
                const vertCorrection = -triVertIndex + reverseTriVertIndex;
                const base = bottomStart + i + 3 * vertCorrection;

                normalArray[base + 0] = -_vec.x;
                normalArray[base + 1] = -_vec.y;
                normalArray[base + 2] = -_vec.z;
            }
        }

        transformToEllipsoid(posArray, ellipsoid);
    } else {
        for (let i = 0; i < capVertices * 3; i += 3) {
            normalArray[i + 0] = 0;
            normalArray[i + 1] = 0;
            normalArray[i + 2] = 1;

            if (thickness > 0) {
                normalArray[capVertices * 3 + i + 0] = 0;
                normalArray[capVertices * 3 + i + 1] = 0;
                normalArray[capVertices * 3 + i + 2] = -1;
            }
        }
    }

    if (thickness > 0) {
        for (let i = capVertices * 2 * 3; i < normalArray.length; i += 9) {
            addFaceNormals(i, posArray, normalArray);
        }
    }

    const mesh = new Mesh();
    getCenter(posArray, mesh.position);
    _vec.copy(mesh.position).multiplyScalar(-1);
    offsetPoints(posArray, _vec.x, _vec.y, _vec.z);

    // Normalize UVs to 0-1 range separately for each face type to avoid overlaps
    // Layout: top faces in top-left, bottom faces in top-right, sides in bottom half
    if (thickness > 0) {
        // Find bounds for each section
        const topStart = 0;
        const topEnd = capVertices * 2;
        const bottomStart = capVertices * 2;
        const bottomEnd = capVertices * 2 * 2;
        const sideStart = capVertices * 2 * 2;
        const sideEnd = totalVerts * 2;

        // Normalize and pack top faces into [0, 0.5] x [0.5, 1.0]
        normalizeUVSection(uvArray, topStart, topEnd, 0, 0.5, 0.5, 1.0);
        // Normalize and pack bottom faces into [0.5, 1.0] x [0.5, 1.0]
        normalizeUVSection(uvArray, bottomStart, bottomEnd, 0.5, 1.0, 0.5, 1.0);
        // Normalize and pack side faces into [0, 1.0] x [0, 0.5]
        normalizeUVSection(uvArray, sideStart, sideEnd, 0, 1.0, 0, 0.5);
    } else {
        // No thickness - just normalize all UVs to full 0-1 range
        normalizeUVSection(uvArray, 0, uvArray.length, 0, 1, 0, 1);
    }

    mesh.geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(posArray), 3, false),
    );
    mesh.geometry.setAttribute("normal", new BufferAttribute(normalArray, 3, false));
    mesh.geometry.setAttribute("uv", new BufferAttribute(uvArray, 2, false));

    if (groups) {
        let offsetIndex = 0;
        let materialIndex = 0;

        let stack = [...groups];
        let vertexCounts = [...groupCapVertices];
        while (stack.length) {
            let count = stack.shift() ?? 0;
            let vertexCount = 0;
            while (count !== 0) {
                vertexCount += vertexCounts.shift() ?? 0;
                count--;
            }

            mesh.geometry.addGroup(offsetIndex, vertexCount, materialIndex);
            materialIndex++;
            offsetIndex += vertexCount;
        }

        if (thickness > 0) {
            stack = [...groups];
            vertexCounts = [...groupCapVertices];
            while (stack.length) {
                let count = stack.shift() ?? 0;
                let vertexCount = 0;
                while (count !== 0) {
                    vertexCount += vertexCounts.shift() ?? 0;
                    count--;
                }

                mesh.geometry.addGroup(offsetIndex, vertexCount, materialIndex);
                materialIndex++;
                offsetIndex += vertexCount;
            }

            stack = [...groups];
            vertexCounts = [...groupEdgeVertices];
            while (stack.length) {
                let count = stack.shift() ?? 0;
                let vertexCount = 0;
                while (count !== 0) {
                    vertexCount += vertexCounts.shift() ?? 0;
                    count--;
                }

                mesh.geometry.addGroup(offsetIndex, vertexCount, materialIndex);
                materialIndex++;
                offsetIndex += vertexCount;
            }
        }
    } else if (thickness > 0) {
        mesh.geometry.addGroup(0, capVertices, 0);
        mesh.geometry.addGroup(capVertices, capVertices, 1);
        mesh.geometry.addGroup(capVertices * 2, edgeVertices, 2);
    }

    return mesh;
}
