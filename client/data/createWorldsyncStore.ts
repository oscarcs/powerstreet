import { createStore } from "tinybase/with-schemas";
import { WorldsyncStore, TABLES_SCHEMA, VALUES_SCHEMA } from "../../shared/WorldsyncStore";

export function createWorldsyncStore(): WorldsyncStore {
    return createStore().setTablesSchema(TABLES_SCHEMA).setValuesSchema(VALUES_SCHEMA);
}
