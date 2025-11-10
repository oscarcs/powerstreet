declare module '@kninnug/constrainautor' {
	import type Delaunator from 'delaunator';

	type Edge = [number, number];

	export default class Constrainautor {
		constructor(delaunay: Delaunator<any>);
		constrainAll(edges: Edge[]): void;
	}
}
