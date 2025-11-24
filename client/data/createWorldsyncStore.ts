import { createStore } from "tinybase/with-schemas";
import { WorldsyncStore, TABLES_SCHEMA, VALUES_SCHEMA } from "../../shared/WorldsyncStore";

export function createWorldsyncStore(): WorldsyncStore {
    const store = createStore().setTablesSchema(TABLES_SCHEMA).setValuesSchema(VALUES_SCHEMA);

    const buildingId = "test-building";

    store.setRow("buildings", buildingId, {
        type: "building",
        floorHeight: 5,
        floorCount: 5,
        baseElevation: 0,
        color: "#cccccc",
        roofType: "flat",
        roofParam: 0,
        tileId: "test-tile",
    });

    const nodes = [
        { x: 0, z: 0 },
        { x: 0, z: 20 },
        { x: 10, z: 20 },
        { x: 10, z: 10 },
        { x: 20, z: 10 },
        { x: 20, z: 0 },
    ];

    nodes.forEach((node, idx) => {
        store.setRow("nodes", `${buildingId}-node-${idx}`, {
            bldgId: buildingId,
            x: node.x,
            z: node.z,
            idx: idx,
        });
    });

    return store;
}
