import { ReplicationOptions } from "rxdb";

export type WorldSyncCheckpointType = {

};

export type WorldSyncCollectionReference<T> = {};

export type WorldSyncCollection<RxDocType> = WorldSyncCollectionReference<RxDocType>;

export type WorldSyncOptions<RxDocType> = {
    collection: WorldSyncCollection<RxDocType>;
};

export type SyncOptionsWorldSync<RxDocType> = Omit<ReplicationOptions<RxDocType, any>, 'pull' | 'push'> & {
    worldSync: WorldSyncOptions<RxDocType>;
};