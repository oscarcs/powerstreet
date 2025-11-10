import { Box3, MathUtils, Vector3 } from 'three';
import type { EllipsoidAdapter } from './types';

const _vec = new Vector3();
const _box = new Box3();

export function getCenter(arr: number[], target: Vector3): void {
	_box.makeEmpty();

	for (let i = 0; i < arr.length; i += 3) {
		_vec.set(arr[i + 0], arr[i + 1], arr[i + 2]);
		_box.expandByPoint(_vec);
	}

	_box.getCenter(target);
}

export function transformToEllipsoid(arr: number[], ellipsoid: EllipsoidAdapter): void {
	for (let i = 0; i < arr.length; i += 3) {
		const lon = arr[i + 0];
		const lat = arr[i + 1];
		const alt = arr[i + 2];
		ellipsoid.getCartographicToPosition(lat * MathUtils.DEG2RAD, lon * MathUtils.DEG2RAD, alt, _vec);
		arr[i + 0] = _vec.x;
		arr[i + 1] = _vec.y;
		arr[i + 2] = _vec.z;
	}
}

export function offsetPoints(arr: number[], x: number, y: number, z: number): void {
	for (let i = 0; i < arr.length; i += 3) {
		arr[i + 0] += x;
		arr[i + 1] += y;
		arr[i + 2] += z;
	}
}
