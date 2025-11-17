import type { Box3, LineSegments, Mesh, Vector3 } from "three";

export type Coordinate2D = [number, number];
export type Coordinate3D = [number, number, number];
export type Coordinate = Coordinate2D | Coordinate3D;

export type LineStringCoords = Coordinate[];
export type PolygonCoords = LineStringCoords[];
export type MultiPolygonCoords = PolygonCoords[];

export type Edge = [number, number];

export interface EllipsoidAdapter {
    getCartographicToPosition(lat: number, lon: number, height: number, target: Vector3): Vector3;
    getCartographicToNormal(lat: number, lon: number, target: Vector3): Vector3;
}

export interface LineObjectOptions {
    flat?: boolean;
    offset?: number;
    ellipsoid?: EllipsoidAdapter | null;
    resolution?: number | null;
    altitudeScale?: number;
    groups?: number[] | null;
}

export interface PolygonMeshOptions extends LineObjectOptions {
    thickness?: number;
    detectSelfIntersection?: boolean;
    useEarcut?: boolean;
}

export interface ParsedGeoJSONObjectBase<TType extends string, TData> {
    type: TType;
    boundingBox: Box3 | null;
    foreign: Record<string, unknown>;
    data: TData;
}

export interface ParsedFeature extends ParsedGeoJSONObjectBase<"Feature", ParsedGeometry | null> {
    id: string | number | null;
    properties: Record<string, unknown> | null | undefined;
    geometries: ParsedGeometry[];
    points?: Array<ParsedPoint | ParsedMultiPoint>;
    lines?: Array<ParsedLineString | ParsedMultiLineString>;
    polygons?: Array<ParsedPolygon | ParsedMultiPolygon>;
}

export interface HasFeatureRef {
    feature: ParsedFeature | null;
}

export interface ParsedPoint
    extends ParsedGeoJSONObjectBase<"Point", LineStringCoords>,
        HasFeatureRef {
    dimension: number | null;
}

export interface ParsedMultiPoint
    extends ParsedGeoJSONObjectBase<"MultiPoint", LineStringCoords>,
        HasFeatureRef {
    dimension: number | null;
}

export interface ParsedLineString
    extends ParsedGeoJSONObjectBase<"LineString", LineStringCoords[]>,
        HasFeatureRef {
    dimension: number | null;
    getLineObject: (options?: LineObjectOptions) => LineSegments;
}

export interface ParsedMultiLineString
    extends ParsedGeoJSONObjectBase<"MultiLineString", LineStringCoords[]>,
        HasFeatureRef {
    dimension: number | null;
    getLineObject: (options?: LineObjectOptions) => LineSegments;
}

export interface ParsedPolygon
    extends ParsedGeoJSONObjectBase<"Polygon", PolygonCoords[]>,
        HasFeatureRef {
    dimension: number | null;
    getLineObject: (options?: LineObjectOptions) => LineSegments;
    getMeshObject: (options?: PolygonMeshOptions) => Mesh;
}

export interface ParsedMultiPolygon
    extends ParsedGeoJSONObjectBase<"MultiPolygon", PolygonCoords[]>,
        HasFeatureRef {
    dimension: number | null;
    getLineObject: (options?: LineObjectOptions) => LineSegments;
    getMeshObject: (options?: PolygonMeshOptions) => Mesh;
}

export interface ParsedGeometryCollection
    extends ParsedGeoJSONObjectBase<"GeometryCollection", ParsedGeometry[]>,
        HasFeatureRef {}

export type ParsedGeometry =
    | ParsedPoint
    | ParsedMultiPoint
    | ParsedLineString
    | ParsedMultiLineString
    | ParsedPolygon
    | ParsedMultiPolygon
    | ParsedGeometryCollection;

export interface ParsedFeatureCollection
    extends ParsedGeoJSONObjectBase<"FeatureCollection", ParsedFeature[]> {}

export type ParsedGeoJSONObject =
    | ParsedGeometry
    | ParsedFeature
    | ParsedFeatureCollection
    | ParsedGeometryCollection;

export interface ParsedGeoJSONResult {
    features: ParsedFeature[];
    geometries: ParsedGeometry[];
    points: Array<ParsedPoint | ParsedMultiPoint>;
    lines: Array<ParsedLineString | ParsedMultiLineString>;
    polygons: Array<ParsedPolygon | ParsedMultiPolygon>;
}

export interface TriangulationResult {
    indices: number[];
    edges: Edge[];
    points: Coordinate[];
}

export type ResampleMode = "grid" | "ellipsoid";
