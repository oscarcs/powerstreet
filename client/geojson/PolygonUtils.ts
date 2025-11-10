import { Vector3 } from 'three';
import { unkinkPolygon } from '@turf/unkink-polygon';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { dedupeCoordinates, isClockWise, isPointInPolygon } from './GeoJSONShapeUtils';
import type { Coordinate, Coordinate3D, PolygonCoords } from './types';

const _min = new Vector3();
const _max = new Vector3();
const _center = new Vector3();

function fixLoop(loop: Coordinate[]): PolygonCoords {
	const polygon = unkinkPolygon({
		type: 'Polygon',
		coordinates: [loop as Position[]],
	});

	return polygon.features.flatMap(feature => {
		const geometry = feature.geometry as Polygon | MultiPolygon;
		if (geometry.type === 'MultiPolygon') {
			return geometry.coordinates.flatMap(inner => inner as Position[][]) as PolygonCoords;
		}

		return geometry.coordinates as Position[][];
	}) as PolygonCoords;
}

export function splitPolygon(polygon: PolygonCoords): PolygonCoords[] {
	const dimension = polygon[0][0].length;

	getPolygonBounds(polygon, _min, _max);
	_center.addVectors(_min, _max).multiplyScalar(0.5);

	polygon.forEach(loop =>
		loop.forEach(coord => {
			coord[0] -= _center.x;
			coord[1] -= _center.y;
		}),
	);

	const [contour, ...holes] = polygon;
	const fixedHoles = holes.flatMap(hole => fixLoop(hole));
	const fixedContours = fixLoop(contour);

	let fixedPolygons: PolygonCoords[];
	if (fixedContours.length === 1) {
		fixedPolygons = [[contour, ...holes]];
	} else {
		fixedPolygons = fixedContours.map(innerContour => {
			const matchingHoles = fixedHoles.filter(hole => {
				const firstVertex = hole[0];
				if (!firstVertex) {
					return false;
				}

				const [hx, hy] = firstVertex;
				return isPointInPolygon([innerContour], hx, hy);
			});
			return [innerContour, ...matchingHoles];
		});
	}

	fixedPolygons.forEach(shape =>
		shape.forEach(loop =>
			loop.forEach(coord => {
				coord[0] += _center.x;
				coord[1] += _center.y;
			}),
		),
	);

	if (fixedPolygons.length > 1 && dimension > 2) {
		fixedPolygons.forEach(shape =>
			shape.forEach(loop =>
				loop.forEach((coord, coordIndex, loopArr) => {
					if (coord.length === 2) {
						const [x, y] = coord;
						loopArr[coordIndex] = [x, y, _center.z] as Coordinate3D;
					}
				}),
			),
		);
	}

	return fixedPolygons;
}

export function getPolygonBounds(polygon: PolygonCoords, min: Vector3, max: Vector3): void {
	min.setScalar(Infinity);
	max.setScalar(-Infinity);

	polygon.forEach(loop =>
		loop.forEach(coord => {
			const [x, y, z = 0] = coord;
			min.x = Math.min(min.x, x);
			min.y = Math.min(min.y, y);
			min.z = Math.min(min.z, z);

			max.x = Math.max(max.x, x);
			max.y = Math.max(max.y, y);
			max.z = Math.max(max.z, z);
		}),
	);
}

export function correctPolygonWinding(polygon: PolygonCoords): PolygonCoords {
	const [contour, ...holes] = polygon;
	if (!isClockWise(contour)) {
		contour.reverse();
	}

	holes.forEach(hole => {
		if (isClockWise(hole)) {
			hole.reverse();
		}
	});

	return polygon;
}

export function dedupePolygonPoints(polygon: PolygonCoords): PolygonCoords {
	return polygon
		.map(loop => dedupeCoordinates(loop.slice()))
		.filter(loop => loop.length > 3);
}

export function countVerticesInPolygons(polygons: PolygonCoords[]): number {
	let total = 0;
	polygons.forEach(polygonShape => {
		polygonShape.forEach(loop => {
			total += loop.length;
		});
	});

	return total;
}
