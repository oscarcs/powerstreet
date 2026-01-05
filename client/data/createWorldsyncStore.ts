import { createStore } from "tinybase/with-schemas";
import { WorldsyncStore, TABLES_SCHEMA, VALUES_SCHEMA } from "../../shared/WorldsyncStore";

/**
 * Generate a test polygon for beta strip algorithm debugging.
 * Creates a pentagon shape (10x scaled from original):
 * Original: [{x:0,y:0}, {x:10,y:0}, {x:10,y:1.5}, {x:9.5,y:2}, {x:0,y:2}]
 * Scaled 10x: [{x:0,z:0}, {x:100,z:0}, {x:100,z:15}, {x:95,z:20}, {x:0,z:20}]
 */
function generateTestRoadGrid(store: WorldsyncStore): void {
    // Define the polygon vertices (10x scale of the original shape)
    const vertices = [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 15 },
        { x: 95, z: 20 },
        { x: 0, z: 20 },
    ];

    // Create nodes
    const nodeIds: string[] = [];
    for (const v of vertices) {
        const nodeId = store.addRow("streetNodes", {
            x: v.x,
            z: v.z,
            elevation: 0,
        });
        if (nodeId) {
            nodeIds.push(nodeId);
        }
    }

    // Create edges connecting the vertices in order (closing the polygon)
    const streetWidth = 10; // All edges same width for simplicity
    for (let i = 0; i < nodeIds.length; i++) {
        const nextI = (i + 1) % nodeIds.length;
        store.addRow("streetEdges", {
            startNodeId: nodeIds[i],
            endNodeId: nodeIds[nextI],
            width: streetWidth,
            roadType: "local",
        });
    }
}

export function createWorldsyncStore(): WorldsyncStore {
    const store = createStore().setTablesSchema(TABLES_SCHEMA).setValuesSchema(VALUES_SCHEMA);

    generateTestRoadGrid(store);

    return store;
}
