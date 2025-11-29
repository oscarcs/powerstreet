import { Store } from "tinybase/with-schemas";

export const TABLES_SCHEMA = {
    buildings: {
        type: { type: "string" },
        roofType: { type: "string" },
        roofParam: { type: "number" },
        tileId: { type: "string" },
        baseElevation: { type: "number" },
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
    buildingId: string
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
export function getSectionBaseElevation(
    store: WorldsyncStore,
    sectionId: string
): number {
    const section = store.getRow("sections", sectionId);
    if (!section.bldgId) return 0;

    const buildingId = section.bldgId as string;
    const sortedSections = getSortedBuildingSections(store, buildingId);
    const found = sortedSections.find((s) => s.sectionId === sectionId);
    return found?.computedBaseElevation ?? 0;
}
