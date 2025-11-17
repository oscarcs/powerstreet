import { MathUtils } from "three";
import type { Coordinate, ParsedGeoJSONObject, PolygonCoords, ResampleMode } from "./types";

type GeoJSONObjectWithSchema = Record<string, unknown> & {
    type?: string;
    bbox?: unknown;
    coordinates?: unknown;
    geometries?: unknown;
    id?: unknown;
    properties?: unknown;
    geometry?: unknown;
    features?: unknown;
};

export function dedupeCoordinates(coords: Coordinate[]): Coordinate[] {
    for (let i = 0; i < coords.length - 1; i++) {
        const ni = (i + 1) % coords.length;
        const c = coords[i];
        const nc = coords[ni];

        if (c[0] === nc[0] && c[1] === nc[1]) {
            coords.splice(ni, 1);
            i--;
        }
    }

    return coords;
}

export function getDimension(coordinates: Coordinate | undefined): number | null {
    return coordinates?.length ?? null;
}

export function extractForeignKeys(object: GeoJSONObjectWithSchema): Record<string, unknown> {
    const result: Record<string, unknown> = { ...object };
    delete result.type;
    delete result.bbox;

    switch (object.type) {
        case "Point":
        case "MultiPoint":
        case "LineString":
        case "MultiLineString":
        case "Polygon":
        case "MultiPolygon":
            delete result.coordinates;
            break;
        case "GeometryCollection":
            delete result.geometries;
            break;
        case "Feature":
            delete result.id;
            delete result.properties;
            delete result.geometry;
            break;
        case "FeatureCollection":
            delete result.features;
            break;
        default:
            break;
    }

    return result;
}

export function traverse(
    object: ParsedGeoJSONObject,
    callback: (object: ParsedGeoJSONObject) => void,
): void {
    callback(object);

    switch (object.type) {
        case "GeometryCollection":
        case "FeatureCollection":
            object.data.forEach((o) => traverse(o, callback));
            break;
        case "Feature":
            if (object.data) {
                traverse(object.data, callback);
            }
            break;
        default:
            break;
    }
}

export function resampleLine(
    loop: Coordinate[],
    minDistance: number,
    mode: ResampleMode = "grid",
): Coordinate[] {
    const result: Coordinate[] = [];
    for (let i = 0; i < loop.length - 1; i++) {
        const ni = (i + 1) % loop.length;
        const c = loop[i];
        const nc = loop[ni];

        const dx = nc[0] - c[0];
        const dy = nc[1] - c[1];
        let steps: number;
        if (mode === "grid") {
            const dist = Math.sqrt(dx ** 2 + dy ** 2);
            steps = Math.ceil(dist / minDistance);
        } else {
            const midy = (c[1] + nc[1]) / 2;
            const yDist = minDistance;
            const xDist = minDistance / Math.sin(Math.PI / 2 + MathUtils.DEG2RAD * midy);

            const ySteps = Math.abs(dy / yDist);
            const xSteps = Math.abs(dx / xDist);

            steps = Math.ceil(Math.max(xSteps, ySteps));
        }

        result.push(c);

        const [cx, cy, cz = 0] = c;
        for (let j = 1; j < steps; j++) {
            const nx = cx + (dx * j) / steps;
            const ny = cy + (dy * j) / steps;
            if (c.length === 3 || nc.length === 3) {
                const nz = cz + ((nc[2] ?? cz) - cz) * (j / steps);
                result.push([nx, ny, nz]);
            } else {
                result.push([nx, ny]);
            }
        }
    }

    result.push(loop[loop.length - 1]);

    return result;
}

export function calculateArea(loop: Coordinate[]): number {
    const n = loop.length;
    let a = 0;

    for (let p = n - 1, q = 0; q < n; p = q++) {
        a += loop[p][0] * loop[q][1] - loop[q][0] * loop[p][1];
    }

    return a * 0.5;
}

export function isClockWise(loop: Coordinate[]): boolean {
    return calculateArea(loop) < 0;
}

export function calculateAngleSum(loop: Coordinate[], x: number, y: number): number {
    let angleSum = 0;
    for (let i = 0; i < loop.length; i++) {
        const ni = (i + 1) % loop.length;
        const c0 = loop[i];
        const c1 = loop[ni];

        let dx0 = c0[0] - x;
        let dy0 = c0[1] - y;
        let dx1 = c1[0] - x;
        let dy1 = c1[1] - y;

        const l0 = Math.sqrt(dx0 ** 2 + dy0 ** 2);
        const l1 = Math.sqrt(dx1 ** 2 + dy1 ** 2);

        dx0 /= l0;
        dy0 /= l0;

        dx1 /= l1;
        dy1 /= l1;

        angleSum += Math.atan2(dx0 * dy1 - dy0 * dx1, dx0 * dx1 + dy0 * dy1);
    }

    return Math.abs(angleSum);
}

export function isPointInPolygon(polygon: PolygonCoords, x: number, y: number): boolean {
    const [contour, ...holes] = polygon;
    const isInContour = calculateAngleSum(contour, x, y) > 3.14;
    if (!isInContour) {
        return false;
    }

    for (const hole of holes) {
        const isInHole = calculateAngleSum(hole, x, y) > 3.14;
        if (isInHole) {
            return false;
        }
    }

    return true;
}
