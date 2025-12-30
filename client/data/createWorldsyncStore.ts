import { createStore } from "tinybase/with-schemas";
import { WorldsyncStore, TABLES_SCHEMA, VALUES_SCHEMA } from "../../shared/WorldsyncStore";

/**
 * Generate a test road grid for block/lot algorithm testing.
 * Creates a 4x4 city block grid (200m x 200m total area).
 */
function generateTestRoadGrid(store: WorldsyncStore): void {
    const gridSize = 5; // 5x5 nodes = 4x4 blocks
    const spacing = 50; // 50m between streets

    // Create a 2D array to store node IDs
    const nodeIds: string[][] = [];

    // Create street nodes in a grid pattern
    for (let row = 0; row < gridSize; row++) {
        nodeIds[row] = [];
        for (let col = 0; col < gridSize; col++) {
            const nodeId = store.addRow("streetNodes", {
                x: col * spacing,
                z: row * spacing,
                elevation: 0,
            });
            if (nodeId) {
                nodeIds[row][col] = nodeId;
            }
        }
    }

    // Create horizontal edges (along rows)
    for (let row = 0; row < gridSize; row++) {
        const isArterial = row % 2 === 0;
        const streetWidth = isArterial ? 20 : 10;

        for (let col = 0; col < gridSize - 1; col++) {
            store.addRow("streetEdges", {
                startNodeId: nodeIds[row][col],
                endNodeId: nodeIds[row][col + 1],
                width: streetWidth,
                roadType: isArterial ? "arterial" : "local",
            });
        }
    }

    // Create vertical edges (along columns)
    for (let row = 0; row < gridSize - 1; row++) {
        for (let col = 0; col < gridSize; col++) {
            const isArterial = col % 2 === 0;
            const streetWidth = isArterial ? 20 : 10;

            store.addRow("streetEdges", {
                startNodeId: nodeIds[row][col],
                endNodeId: nodeIds[row + 1][col],
                width: streetWidth,
                roadType: isArterial ? "arterial" : "local",
            });
        }
    }
}

export function createWorldsyncStore(): WorldsyncStore {
    const store = createStore().setTablesSchema(TABLES_SCHEMA).setValuesSchema(VALUES_SCHEMA);

    generateTestRoadGrid(store);

    return store;
}
