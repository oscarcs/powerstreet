import { createStore } from "tinybase/with-schemas";
import { WorldsyncStore, TABLES_SCHEMA, VALUES_SCHEMA } from "../../shared/WorldsyncStore";

interface SectionConfig {
    baseElevation: number;
    height: number;
    color: string;
    nodes: { x: number; z: number }[];
}

interface BuildingConfig {
    id: string;
    offsetX: number;
    offsetZ: number;
    sections: SectionConfig[];
}

function generateTestBuildings(store: WorldsyncStore): void {
    const buildings: BuildingConfig[] = [
        // Simple single-section building
        {
            id: "building-1",
            offsetX: 0,
            offsetZ: 0,
            sections: [
                {
                    baseElevation: 0,
                    height: 24,
                    color: "#b8c4ce",
                    nodes: [
                        { x: 0, z: 0 },
                        { x: 0, z: 15 },
                        { x: 12, z: 15 },
                        { x: 12, z: 0 },
                    ],
                },
            ],
        },
        // L-shaped building
        {
            id: "building-2",
            offsetX: 25,
            offsetZ: 0,
            sections: [
                {
                    baseElevation: 0,
                    height: 20,
                    color: "#d4c4b0",
                    nodes: [
                        { x: 0, z: 0 },
                        { x: 0, z: 20 },
                        { x: 8, z: 20 },
                        { x: 8, z: 10 },
                        { x: 15, z: 10 },
                        { x: 15, z: 0 },
                    ],
                },
            ],
        },
        // Building with setback - two sections stacked
        {
            id: "building-3",
            offsetX: 55,
            offsetZ: 0,
            sections: [
                {
                    baseElevation: 0,
                    height: 16,
                    color: "#a8b8a8",
                    nodes: [
                        { x: 0, z: 0 },
                        { x: 0, z: 18 },
                        { x: 14, z: 18 },
                        { x: 14, z: 0 },
                    ],
                },
                {
                    baseElevation: 16,
                    height: 12,
                    color: "#98a898",
                    nodes: [
                        { x: 2, z: 2 },
                        { x: 2, z: 16 },
                        { x: 12, z: 16 },
                        { x: 12, z: 2 },
                    ],
                },
            ],
        },
        // Complex multi-section building
        {
            id: "building-4",
            offsetX: 0,
            offsetZ: 30,
            sections: [
                {
                    baseElevation: 0,
                    height: 12,
                    color: "#c8b8b8",
                    nodes: [
                        { x: 0, z: 0 },
                        { x: 0, z: 18 },
                        { x: 18, z: 18 },
                        { x: 18, z: 0 },
                    ],
                },
                {
                    baseElevation: 12,
                    height: 10,
                    color: "#b8a8a8",
                    nodes: [
                        { x: 3, z: 3 },
                        { x: 3, z: 15 },
                        { x: 15, z: 15 },
                        { x: 15, z: 3 },
                    ],
                },
                {
                    baseElevation: 22,
                    height: 8,
                    color: "#a89898",
                    nodes: [
                        { x: 5, z: 5 },
                        { x: 5, z: 13 },
                        { x: 13, z: 13 },
                        { x: 13, z: 5 },
                    ],
                },
            ],
        },
        // Simple tower
        {
            id: "building-5",
            offsetX: 25,
            offsetZ: 30,
            sections: [
                {
                    baseElevation: 0,
                    height: 35,
                    color: "#9898a8",
                    nodes: [
                        { x: 0, z: 0 },
                        { x: 0, z: 16 },
                        { x: 16, z: 16 },
                        { x: 16, z: 0 },
                    ],
                },
            ],
        },
        // Hexagonal building
        {
            id: "building-6",
            offsetX: 55,
            offsetZ: 30,
            sections: [
                {
                    baseElevation: 0,
                    height: 24,
                    color: "#b0a898",
                    nodes: [
                        { x: 0, z: 5 },
                        { x: 0, z: 15 },
                        { x: 5, z: 20 },
                        { x: 10, z: 15 },
                        { x: 10, z: 5 },
                        { x: 5, z: 0 },
                    ],
                },
            ],
        },
        // Tall building with multiple setbacks
        {
            id: "building-7",
            offsetX: 0,
            offsetZ: 60,
            sections: [
                {
                    baseElevation: 0,
                    height: 15,
                    color: "#c0c8d0",
                    nodes: [
                        { x: 0, z: 0 },
                        { x: 0, z: 22 },
                        { x: 12, z: 22 },
                        { x: 12, z: 0 },
                    ],
                },
                {
                    baseElevation: 15,
                    height: 15,
                    color: "#b0b8c0",
                    nodes: [
                        { x: 1, z: 1 },
                        { x: 1, z: 21 },
                        { x: 11, z: 21 },
                        { x: 11, z: 1 },
                    ],
                },
                {
                    baseElevation: 30,
                    height: 10,
                    color: "#a0a8b0",
                    nodes: [
                        { x: 2, z: 2 },
                        { x: 2, z: 20 },
                        { x: 10, z: 20 },
                        { x: 10, z: 2 },
                    ],
                },
            ],
        },
        // Wide stepped building
        {
            id: "building-8",
            offsetX: 25,
            offsetZ: 60,
            sections: [
                {
                    baseElevation: 0,
                    height: 15,
                    color: "#d8d0c8",
                    nodes: [
                        { x: 0, z: 0 },
                        { x: 0, z: 16 },
                        { x: 24, z: 16 },
                        { x: 24, z: 0 },
                    ],
                },
            ],
        },
        // Pentagon-like building
        {
            id: "building-9",
            offsetX: 55,
            offsetZ: 60,
            sections: [
                {
                    baseElevation: 0,
                    height: 20,
                    color: "#a0b0b8",
                    nodes: [
                        { x: 0, z: 0 },
                        { x: 0, z: 14 },
                        { x: 7, z: 20 },
                        { x: 14, z: 14 },
                        { x: 14, z: 0 },
                    ],
                },
            ],
        },
    ];

    for (const building of buildings) {
        store.setRow("buildings", building.id, {
            type: "building",
            roofType: "flat",
            roofParam: 0,
            tileId: "test-tile",
        });

        building.sections.forEach((section, sectionIdx) => {
            const sectionId = `${building.id}-section-${sectionIdx}`;

            store.setRow("sections", sectionId, {
                bldgId: building.id,
                sectionIdx: sectionIdx,
                baseElevation: section.baseElevation,
                height: section.height,
                color: section.color,
            });

            section.nodes.forEach((node, nodeIdx) => {
                store.setRow("nodes", `${sectionId}-node-${nodeIdx}`, {
                    sectionId: sectionId,
                    x: node.x + building.offsetX,
                    z: node.z + building.offsetZ,
                    idx: nodeIdx,
                });
            });
        });
    }
}

export function createWorldsyncStore(): WorldsyncStore {
    const store = createStore().setTablesSchema(TABLES_SCHEMA).setValuesSchema(VALUES_SCHEMA);

    generateTestBuildings(store);

    return store;
}
