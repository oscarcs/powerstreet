import { RxReplicationState } from "rxdb/plugins/replication";
import { SyncOptionsWorldSync, WorldSyncCheckpointType, WorldSyncOptions } from "./worldsync-types";
import { ReplicationPullOptions, ReplicationPushOptions, RxCollection } from "rxdb";

export class RxWorldSyncReplicationState<RxDocType> extends RxReplicationState<RxDocType, WorldSyncCheckpointType> {
    constructor(
        public readonly worldSync: WorldSyncOptions<RxDocType>,
        public readonly replicationIdentifierHash: string,
        public readonly collection: RxCollection<RxDocType>,
        public readonly pull?: ReplicationPullOptions<RxDocType, WorldSyncCheckpointType>,
        public readonly push?: ReplicationPushOptions<RxDocType>,
        public readonly live?: boolean,
        public retryTime: number = 1000 * 5,
        public autoStart: boolean = true
    ) {
        super(
            replicationIdentifierHash,
            collection,
            '_deleted',
            pull,
            push,
            live,
            retryTime,
            autoStart
        );
    }
}

export function replicateWorldSync<RxDocType>(options: SyncOptionsWorldSync<RxDocType>): RxWorldSyncReplicationState<RxDocType> {
    const collection: RxCollection<RxDocType, any, any> = options.collection;
    
    let replicationPrimitivesPull: ReplicationPullOptions<RxDocType, WorldSyncCheckpointType> | undefined = undefined;
    let replicationPrimitivesPush: ReplicationPushOptions<RxDocType> | undefined = undefined;

    const replicationState = new RxWorldSyncReplicationState<RxDocType>(
        options.worldSync,
        options.replicationIdentifier,
        collection,
        replicationPrimitivesPull,
        replicationPrimitivesPush,
        options.live,
        options.retryTime,
        options.autoStart
    );

    return replicationState; 
}