import { createStore, Store } from "tinybase/with-schemas";

const TABLES_SCHEMA = {} as const;

const VALUES_SCHEMA = {
    currentTool: { type: "string" },
} as const;

export type LocalStore = Store<[typeof TABLES_SCHEMA, typeof VALUES_SCHEMA]>;

export function createLocalStore(): LocalStore {
    return createStore()
        .setTablesSchema(TABLES_SCHEMA)
        .setValuesSchema(VALUES_SCHEMA)
        .setValue("currentTool", "select");
}
