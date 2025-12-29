import { Store } from "tinybase/with-schemas";

export const TABLES_SCHEMA = {
    // === BUILDINGS ===
    buildings: {
        type: { type: "string" },
        roofType: { type: "string" },
        roofParam: { type: "number" },
        tileId: { type: "string" },
        baseElevation: { type: "number" },
        lotId: { type: "string" }, // Reference to lot this building sits on
    },
    sections: {
        bldgId: { type: "string" },
        sectionIdx: { type: "number" },
        height: { type: "number" },
        color: { type: "string" },
    },
    nodes: {
        sectionId: { type: "string" },
        x: { type: "number" },
        z: { type: "number" },
        idx: { type: "number" },
    },

    // === STREETS ===
    streetNodes: {
        x: { type: "number" },
        z: { type: "number" },
        elevation: { type: "number" }, // Y-coordinate for 3D/elevated roads
    },
    streetEdges: {
        startNodeId: { type: "string" },
        endNodeId: { type: "string" },
        streetGroupId: { type: "string" },
        width: { type: "number" },
        // Extended metadata for traffic simulation
        roadType: { type: "string" }, // "arterial" | "collector" | "local" | "alley" | "highway"
        speedLimit: { type: "number" }, // km/h
        lanes: { type: "number" }, // Total lane count (both directions)
        oneWay: { type: "boolean" }, // If true, only start→end direction allowed
        // Curve support for non-straight roads
        curveType: { type: "string" }, // "straight" | "arc" | "bezier"
        curveData: { type: "string" }, // JSON: control points for curves
    },
    streetGroups: {
        name: { type: "string" },
        color: { type: "string" },
        defaultWidth: { type: "number" },
        defaultRoadType: { type: "string" },
        defaultSpeedLimit: { type: "number" },
        defaultLanes: { type: "number" },
    },

    // === ZONING & LAND ===
    districts: {
        name: { type: "string" },
        color: { type: "string" },
        // Subdivision rules (for lot generation)
        minLotFrontage: { type: "number" }, // meters
        maxLotFrontage: { type: "number" }, // meters
        minLotArea: { type: "number" }, // square meters
        maxLotDepth: { type: "number" }, // meters
        // Zoning rules (for building generation)
        maxHeight: { type: "number" }, // meters
        maxFAR: { type: "number" }, // floor area ratio
        setbackFront: { type: "number" }, // meters
        setbackSide: { type: "number" }, // meters
        setbackRear: { type: "number" }, // meters
        // Allowed uses (JSON array of strings)
        allowedUses: { type: "string" }, // JSON: ["residential", "commercial", "mixed"]
    },
    blocks: {
        districtId: { type: "string" },
        // Polygon boundary as JSON array of [x, z] coordinates
        boundaryCoords: { type: "string" },
        // Edge IDs that form this block's boundary (for regeneration tracking)
        boundaryEdgeIds: { type: "string" }, // JSON array of edge IDs
    },
    lots: {
        blockId: { type: "string" },
        // Polygon boundary as JSON array of [x, z] coordinates
        boundaryCoords: { type: "string" },
        // Street frontage info
        frontageEdgeId: { type: "string" },
        frontageLength: { type: "number" }, // meters
        area: { type: "number" }, // square meters
        // Current state
        buildingId: { type: "string" }, // null/empty if vacant
        // Economic data (for market simulation)
        landValue: { type: "number" }, // currency units
        zoneCompliance: { type: "boolean" }, // true if current use complies with district rules
    },
} as const;

export const VALUES_SCHEMA = {} as const;

export type WorldsyncStore = Store<[typeof TABLES_SCHEMA, typeof VALUES_SCHEMA]>;

export interface SectionData {
    sectionId: string;
    bldgId: string;
    sectionIdx: number;
    height: number;
    color: string;
}

/**
 * Get all sections for a building, sorted by sectionIdx.
 * Also computes each section's computed base elevation based on
 * the building's baseElevation and cumulative heights of prior sections.
 */
export function getSortedBuildingSections(
    store: WorldsyncStore,
    buildingId: string,
): Array<SectionData & { computedBaseElevation: number }> {
    const building = store.getRow("buildings", buildingId);
    const buildingBaseElevation = (building.baseElevation as number) || 0;

    const sectionIds = store.getRowIds("sections");
    const sections: SectionData[] = [];

    for (const sectionId of sectionIds) {
        const section = store.getRow("sections", sectionId);
        if (section.bldgId === buildingId) {
            sections.push({
                sectionId,
                bldgId: section.bldgId as string,
                sectionIdx: section.sectionIdx as number,
                height: section.height as number,
                color: section.color as string,
            });
        }
    }

    // Sort by sectionIdx
    sections.sort((a, b) => a.sectionIdx - b.sectionIdx);

    // Compute base elevations
    let cumulativeHeight = buildingBaseElevation;
    return sections.map((section) => {
        const computedBaseElevation = cumulativeHeight;
        cumulativeHeight += section.height;
        return { ...section, computedBaseElevation };
    });
}

/**
 * Get the computed base elevation for a specific section.
 */
export function getSectionBaseElevation(store: WorldsyncStore, sectionId: string): number {
    const section = store.getRow("sections", sectionId);
    if (!section.bldgId) return 0;

    const buildingId = section.bldgId as string;
    const sortedSections = getSortedBuildingSections(store, buildingId);
    const found = sortedSections.find((s) => s.sectionId === sectionId);
    return found?.computedBaseElevation ?? 0;
}

export type RoadType = "arterial" | "collector" | "local" | "alley" | "highway";
export type CurveType = "straight" | "arc" | "bezier";
export type LandUse = "residential" | "commercial" | "industrial" | "mixed" | "park" | "civic";

export interface StreetNodeData {
    nodeId: string;
    x: number;
    z: number;
    elevation: number;
}

export interface StreetEdgeData {
    edgeId: string;
    startNodeId: string;
    endNodeId: string;
    streetGroupId: string;
    width: number;
    roadType: RoadType;
    speedLimit: number;
    lanes: number;
    oneWay: boolean;
    curveType: CurveType;
    curveData: string | null;
}

export interface DistrictData {
    districtId: string;
    name: string;
    color: string;
    minLotFrontage: number;
    maxLotFrontage: number;
    minLotArea: number;
    maxLotDepth: number;
    maxHeight: number;
    maxFAR: number;
    setbackFront: number;
    setbackSide: number;
    setbackRear: number;
    allowedUses: LandUse[];
}

export interface BlockData {
    blockId: string;
    districtId: string;
    boundaryCoords: [number, number][]; // Array of [x, z] points
    boundaryEdgeIds: string[];
}

export interface LotData {
    lotId: string;
    blockId: string;
    boundaryCoords: [number, number][]; // Array of [x, z] points
    frontageEdgeId: string;
    frontageLength: number;
    area: number;
    buildingId: string | null;
    landValue: number;
    zoneCompliance: boolean;
}

/**
 * Get a street node with typed data.
 */
export function getStreetNode(store: WorldsyncStore, nodeId: string): StreetNodeData | null {
    const row = store.getRow("streetNodes", nodeId);
    if (!row.x && row.x !== 0) return null;
    return {
        nodeId,
        x: row.x as number,
        z: row.z as number,
        elevation: (row.elevation as number) || 0,
    };
}

/**
 * Get a street edge with typed data and defaults.
 */
export function getStreetEdge(store: WorldsyncStore, edgeId: string): StreetEdgeData | null {
    const row = store.getRow("streetEdges", edgeId);
    if (!row.startNodeId) return null;
    return {
        edgeId,
        startNodeId: row.startNodeId as string,
        endNodeId: row.endNodeId as string,
        streetGroupId: row.streetGroupId as string,
        width: (row.width as number) || 10,
        roadType: (row.roadType as RoadType) || "local",
        speedLimit: (row.speedLimit as number) || 50,
        lanes: (row.lanes as number) || 2,
        oneWay: (row.oneWay as boolean) || false,
        curveType: (row.curveType as CurveType) || "straight",
        curveData: (row.curveData as string) || null,
    };
}

/**
 * Get all edges connected to a node.
 */
export function getEdgesForNode(store: WorldsyncStore, nodeId: string): StreetEdgeData[] {
    const edges: StreetEdgeData[] = [];
    const edgeIds = store.getRowIds("streetEdges");
    for (const edgeId of edgeIds) {
        const edge = getStreetEdge(store, edgeId);
        if (edge && (edge.startNodeId === nodeId || edge.endNodeId === nodeId)) {
            edges.push(edge);
        }
    }
    return edges;
}

/**
 * Get a district with typed data and defaults.
 */
export function getDistrict(store: WorldsyncStore, districtId: string): DistrictData | null {
    const row = store.getRow("districts", districtId);
    if (!row.name) return null;

    let allowedUses: LandUse[] = ["residential", "commercial"];
    try {
        if (row.allowedUses) {
            allowedUses = JSON.parse(row.allowedUses as string);
        }
    } catch {
        // Use default
    }

    return {
        districtId,
        name: row.name as string,
        color: (row.color as string) || "#888888",
        minLotFrontage: (row.minLotFrontage as number) || 10,
        maxLotFrontage: (row.maxLotFrontage as number) || 50,
        minLotArea: (row.minLotArea as number) || 200,
        maxLotDepth: (row.maxLotDepth as number) || 40,
        maxHeight: (row.maxHeight as number) || 50,
        maxFAR: (row.maxFAR as number) || 2.0,
        setbackFront: (row.setbackFront as number) || 5,
        setbackSide: (row.setbackSide as number) || 3,
        setbackRear: (row.setbackRear as number) || 5,
        allowedUses,
    };
}

/**
 * Get a block with parsed coordinates.
 */
export function getBlock(store: WorldsyncStore, blockId: string): BlockData | null {
    const row = store.getRow("blocks", blockId);
    if (!row.districtId) return null;

    let boundaryCoords: [number, number][] = [];
    let boundaryEdgeIds: string[] = [];
    try {
        if (row.boundaryCoords) {
            boundaryCoords = JSON.parse(row.boundaryCoords as string);
        }
        if (row.boundaryEdgeIds) {
            boundaryEdgeIds = JSON.parse(row.boundaryEdgeIds as string);
        }
    } catch {
        // Use defaults
    }

    return {
        blockId,
        districtId: row.districtId as string,
        boundaryCoords,
        boundaryEdgeIds,
    };
}

/**
 * Get a lot with parsed coordinates.
 */
export function getLot(store: WorldsyncStore, lotId: string): LotData | null {
    const row = store.getRow("lots", lotId);
    if (!row.blockId) return null;

    let boundaryCoords: [number, number][] = [];
    try {
        if (row.boundaryCoords) {
            boundaryCoords = JSON.parse(row.boundaryCoords as string);
        }
    } catch {
        // Use defaults
    }

    return {
        lotId,
        blockId: row.blockId as string,
        boundaryCoords,
        frontageEdgeId: (row.frontageEdgeId as string) || "",
        frontageLength: (row.frontageLength as number) || 0,
        area: (row.area as number) || 0,
        buildingId: (row.buildingId as string) || null,
        landValue: (row.landValue as number) || 0,
        zoneCompliance: (row.zoneCompliance as boolean) ?? true,
    };
}

/**
 * Get all lots in a block.
 */
export function getLotsInBlock(store: WorldsyncStore, blockId: string): LotData[] {
    const lots: LotData[] = [];
    const lotIds = store.getRowIds("lots");
    for (const lotId of lotIds) {
        const lot = getLot(store, lotId);
        if (lot && lot.blockId === blockId) {
            lots.push(lot);
        }
    }
    return lots;
}

/**
 * Get all blocks in a district.
 */
export function getBlocksInDistrict(store: WorldsyncStore, districtId: string): BlockData[] {
    const blocks: BlockData[] = [];
    const blockIds = store.getRowIds("blocks");
    for (const blockId of blockIds) {
        const block = getBlock(store, blockId);
        if (block && block.districtId === districtId) {
            blocks.push(block);
        }
    }
    return blocks;
}
