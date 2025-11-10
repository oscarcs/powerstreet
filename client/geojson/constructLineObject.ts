import { BufferAttribute, LineSegments, Vector3 } from 'three';
import { getCenter, offsetPoints, transformToEllipsoid } from './FlatVertexBufferUtils.js';
import { resampleLine } from './GeoJSONShapeUtils.js';
import type { LineObjectOptions, LineStringCoords } from './types.js';

const _vec = new Vector3();

export function constructLineObject(lineStrings: LineStringCoords[], options: LineObjectOptions = {}): LineSegments {
	const {
		flat = false,
		offset = 0,
		ellipsoid = null,
		resolution = null,
		altitudeScale = 1,
		groups = null,
	} = options;

	const processedLineStrings: LineStringCoords[] = resolution !== null
		? lineStrings.map(loop => resampleLine(loop, resolution, ellipsoid ? 'ellipsoid' : 'grid'))
		: lineStrings;

	let totalSegments = 0;
	processedLineStrings.forEach(vertices => {
		const segments = vertices.length - 1;
		totalSegments += segments * 2;
	});

	let index = 0;
	const posArray: number[] = new Array(totalSegments * 3);
	const vertexCounts: number[] = [];
	processedLineStrings.forEach(vertices => {
		const length = vertices.length;
		const segments = length - 1;
		for (let i = 0; i < segments; i++) {
			const ni = (i + 1) % length;

			const v0 = vertices[i];
			const v1 = vertices[ni];
			posArray[index + 0] = v0[0];
			posArray[index + 1] = v0[1];
			posArray[index + 2] = (flat ? 0 : v0[2] ?? 0) * altitudeScale + offset;

			posArray[index + 3] = v1[0];
			posArray[index + 4] = v1[1];
			posArray[index + 5] = (flat ? 0 : v1[2] ?? 0) * altitudeScale + offset;

			index += 6;
		}

		vertexCounts.push(segments * 2);
	});

	if (ellipsoid) {
		transformToEllipsoid(posArray, ellipsoid);
	}

	const line = new LineSegments();
	getCenter(posArray, line.position);
	_vec.copy(line.position).multiplyScalar(-1);
	offsetPoints(posArray, _vec.x, _vec.y, _vec.z);

	line.geometry.setAttribute('position', new BufferAttribute(new Float32Array(posArray), 3, false));

	if (groups) {
		const stack = [...groups];
		let offsetIndex = 0;
		let materialIndex = 0;
		while (stack.length) {
			let count = stack.shift() ?? 0;
			let vertexCount = 0;
			while (count !== 0) {
				vertexCount += vertexCounts.shift() ?? 0;
				count--;
			}

			line.geometry.addGroup(offsetIndex, vertexCount, materialIndex);
			materialIndex++;
			offsetIndex += vertexCount;
		}
	}

	return line;
}
