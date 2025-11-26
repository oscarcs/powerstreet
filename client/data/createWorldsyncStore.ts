import { createStore } from "tinybase/with-schemas";
import { WorldsyncStore, TABLES_SCHEMA, VALUES_SCHEMA } from "../../shared/WorldsyncStore";

interface BuildingConfig {
    id: string;
    offsetX: number;
    offsetZ: number;
    nodes: { x: number; z: number }[];
    floorHeight: number;
    floorCount: number;
    color: string;
}

function generateTestBuildings(store: WorldsyncStore): void {
    const buildings: BuildingConfig[] = [
        {
            id: "building-1",
            offsetX: 0,
            offsetZ: 0,
            nodes: [
                { x: 0, z: 0 },
                { x: 0, z: 15 },
                { x: 12, z: 15 },
                { x: 12, z: 0 },
            ],
            floorHeight: 4,
            floorCount: 6,
            color: "#b8c4ce",
        },
        {
            id: "building-2",
            offsetX: 25,
            offsetZ: 0,
            nodes: [
                { x: 0, z: 0 },
                { x: 0, z: 20 },
                { x: 8, z: 20 },
                { x: 8, z: 10 },
                { x: 15, z: 10 },
                { x: 15, z: 0 },
            ],
            floorHeight: 5,
            floorCount: 4,
            color: "#d4c4b0",
        },
        {
            id: "building-3",
            offsetX: 55,
            offsetZ: 0,
            nodes: [
                { x: 0, z: 0 },
                { x: 0, z: 18 },
                { x: 10, z: 18 },
                { x: 10, z: 0 },
            ],
            floorHeight: 3,
            floorCount: 8,
            color: "#a8b8a8",
        },
        {
            id: "building-4",
            offsetX: 0,
            offsetZ: 30,
            nodes: [
                { x: 0, z: 0 },
                { x: 0, z: 12 },
                { x: 6, z: 12 },
                { x: 6, z: 18 },
                { x: 14, z: 18 },
                { x: 14, z: 0 },
            ],
            floorHeight: 4,
            floorCount: 5,
            color: "#c8b8b8",
        },
        {
            id: "building-5",
            offsetX: 25,
            offsetZ: 30,
            nodes: [
                { x: 0, z: 0 },
                { x: 0, z: 16 },
                { x: 16, z: 16 },
                { x: 16, z: 0 },
            ],
            floorHeight: 5,
            floorCount: 7,
            color: "#9898a8",
        },
        {
            id: "building-6",
            offsetX: 55,
            offsetZ: 30,
            nodes: [
                { x: 0, z: 5 },
                { x: 0, z: 15 },
                { x: 5, z: 20 },
                { x: 10, z: 15 },
                { x: 10, z: 5 },
                { x: 5, z: 0 },
            ],
            floorHeight: 4,
            floorCount: 6,
            color: "#b0a898",
        },
        {
            id: "building-7",
            offsetX: 0,
            offsetZ: 60,
            nodes: [
                { x: 0, z: 0 },
                { x: 0, z: 22 },
                { x: 8, z: 22 },
                { x: 8, z: 0 },
            ],
            floorHeight: 3,
            floorCount: 10,
            color: "#c0c8d0",
        },
        {
            id: "building-8",
            offsetX: 25,
            offsetZ: 60,
            nodes: [
                { x: 0, z: 0 },
                { x: 0, z: 8 },
                { x: 8, z: 8 },
                { x: 8, z: 16 },
                { x: 16, z: 16 },
                { x: 16, z: 8 },
                { x: 24, z: 8 },
                { x: 24, z: 0 },
            ],
            floorHeight: 5,
            floorCount: 3,
            color: "#d8d0c8",
        },
        {
            id: "building-9",
            offsetX: 55,
            offsetZ: 60,
            nodes: [
                { x: 0, z: 0 },
                { x: 0, z: 14 },
                { x: 7, z: 20 },
                { x: 14, z: 14 },
                { x: 14, z: 0 },
            ],
            floorHeight: 4,
            floorCount: 5,
            color: "#a0b0b8",
        },
    ];

    for (const building of buildings) {
        store.setRow("buildings", building.id, {
            type: "building",
            floorHeight: building.floorHeight,
            floorCount: building.floorCount,
            baseElevation: 0,
            color: building.color,
            roofType: "flat",
            roofParam: 0,
            tileId: "test-tile",
        });

        building.nodes.forEach((node, idx) => {
            store.setRow("nodes", `${building.id}-node-${idx}`, {
                bldgId: building.id,
                x: node.x + building.offsetX,
                z: node.z + building.offsetZ,
                idx: idx,
            });
        });
    }
}

export function createWorldsyncStore(): WorldsyncStore {
    const store = createStore().setTablesSchema(TABLES_SCHEMA).setValuesSchema(VALUES_SCHEMA);

    generateTestBuildings(store);

    return store;
}
