import { Store } from "tinybase/with-schemas";

export const TABLES_SCHEMA = {
    buildings: {
        type: { type: "string" },
        floorHeight: { type: "number" },
        floorCount: { type: "number" },
        baseElevation: { type: "number" },
        color: { type: "string" },
        roofType: { type: "string" },
        roofParam: { type: "number" },
        tileId: { type: "string" },
    },
    nodes: {
        bldgId: { type: "string" },
        x: { type: "number" },
        z: { type: "number" },
        idx: { type: "number" },
    },
} as const;

export const VALUES_SCHEMA = {} as const;

export type WorldsyncStore = Store<[typeof TABLES_SCHEMA, typeof VALUES_SCHEMA]>;
