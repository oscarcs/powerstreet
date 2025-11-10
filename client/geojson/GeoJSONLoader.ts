import type {
	Feature,
	FeatureCollection,
	GeoJsonObject,
	GeometryCollection,
	LineString as GeoLineString,
	MultiLineString,
	MultiPoint as GeoMultiPoint,
	MultiPolygon as GeoMultiPolygon,
	Point as GeoPoint,
	Polygon as GeoPolygon,
} from 'geojson';
import type { Box3 } from 'three';
import { constructLineObject } from './constructLineObject';
import { constructPolygonMeshObject } from './constructPolygonMeshObject';
import { extractForeignKeys, getDimension, traverse } from './GeoJSONShapeUtils';
import { parseBounds } from './ParseUtils';
import type {
	LineObjectOptions,
	ParsedFeature,
	ParsedFeatureCollection,
	ParsedGeoJSONObject,
	ParsedGeoJSONResult,
	ParsedGeometry,
	ParsedGeometryCollection,
	ParsedLineString,
	ParsedMultiLineString,
	ParsedMultiPoint,
	ParsedPoint,
	ParsedPolygon,
	ParsedMultiPolygon,
	PolygonMeshOptions,
	PolygonCoords,
	LineStringCoords,
} from './types.js';
import type { Coordinate } from './types.js';

interface BaseFields<TType extends ParsedGeoJSONObject['type'], TData> {
	type: TType;
	boundingBox: Box3 | null;
	data: TData;
	foreign: Record<string, unknown>;
}

function getBase<TType extends ParsedGeoJSONObject['type'], TData>(object: GeoJsonObject & { type: TType }): BaseFields<TType, TData> {
	return {
		type: object.type,
		boundingBox: parseBounds(object.bbox ?? undefined),
		data: null as TData,
		foreign: extractForeignKeys(object as unknown as Record<string, unknown>),
	};
}

function getLineObject(this: ParsedLineString | ParsedMultiLineString, options: LineObjectOptions = {}) {
	return constructLineObject(this.data, options);
}

function getPolygonLineObject(this: ParsedPolygon | ParsedMultiPolygon, options: LineObjectOptions = {}) {
	const lineData: LineStringCoords[] = this.data.flatMap(shape => shape);
	return constructLineObject(lineData, options);
}

function getPolygonMeshObject(this: ParsedPolygon | ParsedMultiPolygon, options: PolygonMeshOptions = {}) {
	return constructPolygonMeshObject(this.data, options);
}

export class GeoJSONLoader {
	private readonly fetchOptions: RequestInit;

	constructor(fetchOptions: RequestInit = {}) {
		this.fetchOptions = fetchOptions;
	}

	static getLineObject(objects: ParsedGeometry[], options: LineObjectOptions = {}) {
		const lines: LineStringCoords[] = [];
		const groups: number[] = [];

		objects.forEach(object => {
			if (object.type === 'LineString' || object.type === 'MultiLineString') {
				lines.push(...object.data);
				groups.push(object.data.length);
			} else if (object.type === 'Polygon' || object.type === 'MultiPolygon') {
				const shapes = object.data.flatMap(shape => shape);
				lines.push(...shapes);
				groups.push(shapes.length);
			}
		});

		return constructLineObject(lines, {
			...options,
			groups,
		});
	}

	static getMeshObject(objects: ParsedGeometry[], options: PolygonMeshOptions = {}) {
		const polygons: PolygonCoords[] = [];
		const groups: number[] = [];

		objects.forEach(object => {
			if (object.type === 'Polygon' || object.type === 'MultiPolygon') {
				polygons.push(...object.data);
				groups.push(object.data.length);
			}
		});

		return constructPolygonMeshObject(polygons, {
			...options,
			groups,
		});
	}

	async loadAsync(url: string): Promise<ParsedGeoJSONResult> {
		const response = await fetch(url, this.fetchOptions);
		const json = await response.json();
		return this.parse(json);
	}

	parse(json: GeoJsonObject | string): ParsedGeoJSONResult {
		const parsed = typeof json === 'string' ? (JSON.parse(json) as GeoJsonObject) : json;
		const root = this.parseObject(parsed);
		const features: ParsedFeature[] = [];
		const geometries: ParsedGeometry[] = [];

		traverse(root, object => {
			if (object.type === 'FeatureCollection' || object.type === 'GeometryCollection') {
				return;
			}

			if (object.type === 'Feature') {
				features.push(object);
			} else {
				const geometry = object as ParsedGeometry;
				geometries.push(geometry);

				if (geometry.feature) {
					geometry.feature.geometries.push(geometry);
				}
			}
		});

		features.forEach(feature => {
			const featureGeometries = feature.geometries;
			feature.points = featureGeometries.filter(object => /Point/.test(object.type)) as Array<ParsedPoint | ParsedMultiPoint>;
			feature.lines = featureGeometries.filter(object => /Line/.test(object.type)) as Array<ParsedLineString | ParsedMultiLineString>;
			feature.polygons = featureGeometries.filter(object => /Polygon/.test(object.type)) as Array<ParsedPolygon | ParsedMultiPolygon>;
		});

		return {
			features,
			geometries,
			points: geometries.filter(object => /Point/.test(object.type)) as Array<ParsedPoint | ParsedMultiPoint>,
			lines: geometries.filter(object => /Line/.test(object.type)) as Array<ParsedLineString | ParsedMultiLineString>,
			polygons: geometries.filter(object => /Polygon/.test(object.type)) as Array<ParsedPolygon | ParsedMultiPolygon>,
		};
	}

	private parseObject(object: GeoJsonObject, feature: ParsedFeature | null = null): ParsedGeoJSONObject {
		switch (object.type) {
			case 'Point': {
				const point = object as GeoPoint;
				return {
					...getBase<'Point', LineStringCoords>(point),
					feature,
					data: [point.coordinates as Coordinate],
					dimension: getDimension(point.coordinates as Coordinate),
				} as ParsedPoint;
			}
			case 'MultiPoint': {
				const multiPoint = object as GeoMultiPoint;
				const coords = multiPoint.coordinates as Coordinate[];
				return {
					...getBase<'MultiPoint', LineStringCoords>(multiPoint),
					feature,
					data: coords,
					dimension: coords.length > 0 ? getDimension(coords[0]) : null,
				} as ParsedMultiPoint;
			}
			case 'LineString': {
				const lineString = object as GeoLineString;
				const coords = lineString.coordinates as Coordinate[];
				return {
					...getBase<'LineString', LineStringCoords[]>(lineString),
					feature,
					data: [coords],
					dimension: coords.length > 0 ? getDimension(coords[0]) : null,
					getLineObject,
				} as ParsedLineString;
			}
			case 'MultiLineString': {
				const multiLine = object as MultiLineString;
				const coords = multiLine.coordinates as Coordinate[][];
				return {
					...getBase<'MultiLineString', LineStringCoords[]>(multiLine),
					feature,
					data: coords,
					dimension: coords.length > 0 && coords[0].length > 0 ? getDimension(coords[0][0]) : null,
					getLineObject,
				} as ParsedMultiLineString;
			}
			case 'Polygon': {
				const polygon = object as GeoPolygon;
				const coords = polygon.coordinates as Coordinate[][];
				return {
					...getBase<'Polygon', PolygonCoords[]>(polygon),
					feature,
					data: [coords],
					dimension: coords.length > 0 && coords[0].length > 0 ? getDimension(coords[0][0]) : null,
					getLineObject: getPolygonLineObject,
					getMeshObject: getPolygonMeshObject,
				} as ParsedPolygon;
			}
			case 'MultiPolygon': {
				const multiPolygon = object as GeoMultiPolygon;
				const coords = multiPolygon.coordinates as Coordinate[][][];
				return {
					...getBase<'MultiPolygon', PolygonCoords[]>(multiPolygon),
					feature,
					data: coords,
					dimension: coords.length > 0 && coords[0].length > 0 && coords[0][0].length > 0 ? getDimension(coords[0][0][0]) : null,
					getLineObject: getPolygonLineObject,
					getMeshObject: getPolygonMeshObject,
				} as ParsedMultiPolygon;
			}
			case 'GeometryCollection': {
				const geometryCollection = object as GeometryCollection;
				const data = geometryCollection.geometries.map(geometry =>
					this.parseObject(geometry as GeoJsonObject, feature) as ParsedGeometry,
				);

				return {
					...getBase<'GeometryCollection', ParsedGeometry[]>(geometryCollection),
					feature,
					data,
				} as ParsedGeometryCollection;
			}
			case 'Feature': {
				const featureObject = object as Feature;
				const parsedFeature: ParsedFeature = {
					...getBase<'Feature', ParsedGeometry | null>(featureObject),
					id: featureObject.id ?? null,
					properties: featureObject.properties as Record<string, unknown> | null | undefined,
					geometries: [],
					data: null,
				};

				parsedFeature.data = featureObject.geometry
					? (this.parseObject(featureObject.geometry as GeoJsonObject, parsedFeature) as ParsedGeometry)
					: null;

				return parsedFeature;
			}
			case 'FeatureCollection': {
				const featureCollection = object as FeatureCollection;
				const data = featureCollection.features.map(feat =>
					this.parseObject(feat as GeoJsonObject, null) as ParsedFeature,
				);

				return {
					...getBase<'FeatureCollection', ParsedFeature[]>(featureCollection),
					data,
				} as ParsedFeatureCollection;
			}
			default:
				throw new Error(`Unsupported GeoJSON type: ${object.type}`);
		}
	}
}
