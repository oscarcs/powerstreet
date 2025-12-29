/**
 * SyncClient - Handles WebSocket sync between TinyBase and the WorldSync Durable Object.
 *
 * Features:
 * - Connects to WorldSync via WebSocket
 * - Subscribes to tables and receives full sync on connect
 * - Listens to TinyBase changes and sends deltas to server
 * - Receives deltas from server and applies to local store
 * - Handles reconnection with exponential backoff
 */

import { WorldsyncStore, TABLES_SCHEMA } from "../../shared/WorldsyncStore";

// Sync message types (mirror of server types)
type SyncMessageType = "subscribe" | "unsubscribe" | "delta" | "fullSync" | "ack" | "error" | "welcome";

interface RowChange {
    rowId: string;
    operation: "insert" | "update" | "delete";
    data?: Record<string, unknown>;
}

interface SyncMessage {
    type: SyncMessageType;
    messageId?: string;
    table?: string;
    tables?: string[];
    changes?: RowChange[];
    rows?: Record<string, Record<string, unknown>>;
    error?: string;
    clientId?: string;
}

type TableName = keyof typeof TABLES_SCHEMA;

export interface SyncClientOptions {
    serverUrl: string;
    tables: TableName[];
    reconnectDelayMs?: number;
    maxReconnectDelayMs?: number;
    onConnected?: () => void;
    onDisconnected?: () => void;
    onError?: (error: string) => void;
}

const DEFAULT_OPTIONS: Partial<SyncClientOptions> = {
    reconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
};

export class SyncClient {
    private store: WorldsyncStore;
    private options: SyncClientOptions;
    private ws: WebSocket | null = null;
    private clientId: string | null = null;
    private isConnected = false;
    private isApplyingRemoteChanges = false;
    private pendingMessages: Map<string, { resolve: () => void; reject: (error: Error) => void }> = new Map();
    private listenerIds: string[] = [];
    private reconnectAttempts = 0;
    private reconnectTimeout: number | null = null;

    constructor(store: WorldsyncStore, options: SyncClientOptions) {
        this.store = store;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * Connect to the sync server.
     */
    connect(): void {
        if (this.ws) {
            this.disconnect();
        }

        try {
            this.ws = new WebSocket(this.options.serverUrl);
            this.ws.onopen = () => this.handleOpen();
            this.ws.onclose = () => this.handleClose();
            this.ws.onerror = (event) => this.handleError(event);
            this.ws.onmessage = (event) => this.handleMessage(event);
        } catch (error) {
            console.error("Failed to create WebSocket:", error);
            this.scheduleReconnect();
        }
    }

    /**
     * Disconnect from the sync server.
     */
    disconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.removeStoreListeners();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.clientId = null;
    }

    /**
     * Check if connected.
     */
    get connected(): boolean {
        return this.isConnected;
    }

    private handleOpen(): void {
        console.log("SyncClient: Connected to server");
        this.reconnectAttempts = 0;
        // Wait for welcome message before marking as connected
    }

    private handleClose(): void {
        console.log("SyncClient: Disconnected from server");
        this.isConnected = false;
        this.options.onDisconnected?.();
        this.scheduleReconnect();
    }

    private handleError(event: Event): void {
        console.error("SyncClient: WebSocket error", event);
        this.options.onError?.("WebSocket error");
    }

    private handleMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data) as SyncMessage;
            this.processMessage(message);
        } catch (error) {
            console.error("SyncClient: Failed to parse message", error);
        }
    }

    private processMessage(message: SyncMessage): void {
        switch (message.type) {
            case "welcome":
                this.handleWelcome(message);
                break;

            case "fullSync":
                this.handleFullSync(message);
                break;

            case "delta":
                this.handleDelta(message);
                break;

            case "ack":
                this.handleAck(message);
                break;

            case "error":
                console.error("SyncClient: Server error:", message.error);
                this.options.onError?.(message.error || "Unknown server error");
                break;
        }
    }

    private handleWelcome(message: SyncMessage): void {
        this.clientId = message.clientId || null;
        this.isConnected = true;
        console.log("SyncClient: Received welcome, clientId:", this.clientId);

        // Subscribe to configured tables
        this.subscribe(this.options.tables);

        // Set up store listeners for change tracking
        this.setupStoreListeners();

        this.options.onConnected?.();
    }

    private handleFullSync(message: SyncMessage): void {
        if (!message.table || !message.rows) return;

        console.log(`SyncClient: Full sync for table ${message.table}, ${Object.keys(message.rows).length} rows`);

        this.isApplyingRemoteChanges = true;
        try {
            const table = message.table as TableName;

            // Clear existing rows in this table
            const existingIds = this.store.getRowIds(table);
            for (const rowId of existingIds) {
                this.store.delRow(table, rowId);
            }

            // Add rows from server
            for (const [rowId, data] of Object.entries(message.rows)) {
                this.store.setRow(table, rowId, data);
            }
        } finally {
            this.isApplyingRemoteChanges = false;
        }
    }

    private handleDelta(message: SyncMessage): void {
        if (!message.table || !message.changes) return;

        // Ignore our own changes
        if (message.clientId === this.clientId) return;

        console.log(`SyncClient: Delta for table ${message.table}, ${message.changes.length} changes`);

        this.isApplyingRemoteChanges = true;
        try {
            const table = message.table as TableName;

            for (const change of message.changes) {
                switch (change.operation) {
                    case "insert":
                    case "update":
                        if (change.data) {
                            this.store.setRow(table, change.rowId, change.data);
                        }
                        break;

                    case "delete":
                        this.store.delRow(table, change.rowId);
                        break;
                }
            }
        } finally {
            this.isApplyingRemoteChanges = false;
        }
    }

    private handleAck(message: SyncMessage): void {
        if (message.messageId) {
            const pending = this.pendingMessages.get(message.messageId);
            if (pending) {
                pending.resolve();
                this.pendingMessages.delete(message.messageId);
            }
        }
    }

    private subscribe(tables: TableName[]): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const message: SyncMessage = {
            type: "subscribe",
            tables: tables as string[],
            messageId: crypto.randomUUID(),
        };

        this.ws.send(JSON.stringify(message));
    }

    private setupStoreListeners(): void {
        // Listen to row changes for all subscribed tables
        for (const table of this.options.tables) {
            // Listen for row additions/updates
            const rowListenerId = this.store.addRowListener(table, null, (store, tableId, rowId) => {
                if (this.isApplyingRemoteChanges) return;
                if (!rowId) return;

                const row = store.getRow(tableId as TableName, rowId);
                if (Object.keys(row).length === 0) {
                    // Row was deleted
                    this.sendDelta(tableId, [
                        {
                            rowId,
                            operation: "delete",
                        },
                    ]);
                } else {
                    // Row was added or updated
                    this.sendDelta(tableId, [
                        {
                            rowId,
                            operation: "update", // Use update for both insert and update
                            data: row,
                        },
                    ]);
                }
            });
            this.listenerIds.push(rowListenerId);
        }
    }

    private removeStoreListeners(): void {
        for (const listenerId of this.listenerIds) {
            this.store.delListener(listenerId);
        }
        this.listenerIds = [];
    }

    private sendDelta(table: string, changes: RowChange[]): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const messageId = crypto.randomUUID();
        const message: SyncMessage = {
            type: "delta",
            table,
            changes,
            messageId,
        };

        this.ws.send(JSON.stringify(message));

        // Track pending message (optional: for ack handling)
        // We don't currently wait for acks, but the infrastructure is here
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimeout) return;

        const delay = Math.min(
            (this.options.reconnectDelayMs || 1000) * Math.pow(2, this.reconnectAttempts),
            this.options.maxReconnectDelayMs || 30000
        );

        console.log(`SyncClient: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

        this.reconnectTimeout = window.setTimeout(() => {
            this.reconnectTimeout = null;
            this.reconnectAttempts++;
            this.connect();
        }, delay);
    }
}
