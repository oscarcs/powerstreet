import Delaunator from "delaunator";
import Constrainautor from "@kninnug/constrainautor";
import type { Coordinate, Edge, TriangulationResult } from "./types";

export function getLoopEdges(loop: Coordinate[], offset: number, target: Edge[] = []): Edge[] {
    loop.forEach((_, index) => {
        const e0 = index + offset;
        const e1 = ((index + 1) % loop.length) + offset;
        target.push([e0, e1]);
    });

    return target;
}

function findTriangleWithEdge(
    triangles: Uint32Array | Int32Array | Uint16Array | Int16Array | ArrayLike<number>,
    edge: Edge,
): number {
    const [e0, e1] = edge;
    for (let i = 0; i < triangles.length; i += 3) {
        for (let j = 0; j < 3; j++) {
            const n = (j + 1) % 3;
            const t0 = triangles[i + j];
            const t1 = triangles[i + n];

            if (t0 === e0 && t1 === e1) {
                return i / 3;
            }
        }
    }

    return -1;
}

export function triangulate(
    contour: Coordinate[],
    holes: Coordinate[][],
    extraPoints: Coordinate[] = [],
): TriangulationResult {
    let offset = 0;
    const constrainedIndices: Edge[] = [];
    getLoopEdges(contour, offset, constrainedIndices);
    offset += contour.length;

    holes.forEach((hole) => {
        getLoopEdges(hole, offset, constrainedIndices);
        offset += hole.length;
    });

    const points: Coordinate[] = [...contour, ...holes.flatMap((hole) => hole), ...extraPoints];
    const points2d: Array<[number, number]> = points.map((coord) => [coord[0], coord[1]]);

    const delaunay = Delaunator.from(points2d);
    const con = new Constrainautor(delaunay);
    con.constrainAll(constrainedIndices);

    const { triangles, halfedges } = delaunay;
    const startEdge = constrainedIndices[0];
    if (!startEdge) {
        throw new Error("Unable to triangulate polygon: no edges defined");
    }

    const startTri = findTriangleWithEdge(triangles, startEdge);
    if (startTri === -1) {
        throw new Error("Unable to triangulate polygon: start triangle not found");
    }

    const edgeHashSet = new Set<string>();
    constrainedIndices.forEach(([e0, e1]) => {
        edgeHashSet.add(`${e0}_${e1}`);
    });

    const result: number[] = [];
    const traversed = new Set<number>();
    const stack: number[] = [startTri];
    while (stack.length > 0) {
        const tri = stack.pop();
        if (tri === undefined || traversed.has(tri)) {
            continue;
        }

        traversed.add(tri);

        const tri3 = 3 * tri;
        for (let v = 0; v < 3; v++) {
            result.push(triangles[tri3 + v]);

            const siblingEdge = halfedges[tri3 + v];
            if (siblingEdge === -1) {
                continue;
            }

            const otherTri = Math.floor(siblingEdge / 3);
            if (traversed.has(otherTri)) {
                continue;
            }

            const p0 = siblingEdge - otherTri * 3;
            const p1 = (p0 + 1) % 3;
            const e0 = triangles[otherTri * 3 + p0];
            const e1 = triangles[otherTri * 3 + p1];
            const found = edgeHashSet.has(`${e1}_${e0}`);

            if (!found) {
                stack.push(otherTri);
            }
        }
    }

    return {
        indices: result,
        edges: constrainedIndices,
        points,
    };
}
