import { Store } from "tinybase/with-schemas";

export const TABLES_SCHEMA = {
    buildings: {
        type: { type: "string" },
        roofType: { type: "string" },
        roofParam: { type: "number" },
        tileId: { type: "string" },
    },
    sections: {
        bldgId: { type: "string" },
        sectionIdx: { type: "number" },
        baseElevation: { type: "number" },
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
