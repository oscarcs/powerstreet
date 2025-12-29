import { DurableObject } from "cloudflare:workers";

export type SyncMessageType =
    | "subscribe"
    | "unsubscribe"
    | "delta"
    | "fullSync"
    | "ack"
    | "error"
    | "welcome";

export interface RowChange {
    rowId: string;
    operation: "insert" | "update" | "delete";
    data?: Record<string, unknown>;
}

export interface SyncMessage {
    type: SyncMessageType;
    messageId?: string;
    table?: string;
    tables?: string[];
    changes?: RowChange[];
    rows?: Record<string, Record<string, unknown>>;
    error?: string;
    clientId?: string;
}

interface SessionData {
    id: string;
    subscribedTables: Set<string>;
}

export default {
    async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
        if (request.url.endsWith("/websocket")) {
            const upgradeHeader = request.headers.get("Upgrade");
            if (!upgradeHeader || upgradeHeader !== "websocket") {
                return new Response("Worker expected Upgrade: websocket", {
                    status: 426,
                });
            }

            if (request.method !== "GET") {
                return new Response("Method not allowed", {
                    status: 405,
                    headers: { Allow: "GET" },
                });
            }

            let stub = env.WORLDSYNC_DO.getByName("default");
            return stub.fetch(request);
        }

        return new Response(
            `Supported endpoints: /websocket: expects a WebSocket Upgrade request`,
            { status: 200, headers: { "Content-Type": "text/plain" } }
        );
    },
};

export class WorldSyncDurableObject extends DurableObject {
    sessions: Map<WebSocket, SessionData>;

    constructor(ctx: DurableObjectState, env: any) {
        super(ctx, env);
        this.sessions = new Map();

        // Restore existing sessions on hibernation wake
        this.ctx.getWebSockets().forEach((webSocket) => {
            const attachment = webSocket.deserializeAttachment();
            if (attachment) {
                this.sessions.set(webSocket, {
                    id: attachment.id,
                    subscribedTables: new Set(attachment.subscribedTables || []),
                });
            }
        });

        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }

    async fetch(request: Request): Promise<Response> {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        // Accept the WebSocket connection in a 'hibernatable' way
        this.ctx.acceptWebSocket(server);

        const clientId = crypto.randomUUID();
        const sessionData: SessionData = {
            id: clientId,
            subscribedTables: new Set(),
        };

        server.serializeAttachment({
            id: clientId,
            subscribedTables: [],
        });
        this.sessions.set(server, sessionData);

        // Send welcome message with client ID
        const welcomeMessage: SyncMessage = {
            type: "welcome",
            clientId,
        };
        server.send(JSON.stringify(welcomeMessage));

        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer) {
        const session = this.sessions.get(webSocket);
        if (!session) {
            console.error("Received message from unknown session");
            return;
        }

        try {
            const messageStr = typeof message === "string" ? message : new TextDecoder().decode(message);
            const parsed = JSON.parse(messageStr) as SyncMessage;

            await this.handleMessage(webSocket, session, parsed);
        } catch (error) {
            console.error("Failed to parse message:", error);
            this.sendError(webSocket, "Invalid message format");
        }
    }

    private async handleMessage(webSocket: WebSocket, session: SessionData, message: SyncMessage) {
        switch (message.type) {
            case "subscribe":
                await this.handleSubscribe(webSocket, session, message);
                break;

            case "unsubscribe":
                await this.handleUnsubscribe(session, message);
                break;

            case "delta":
                await this.handleDelta(webSocket, session, message);
                break;

            default:
                this.sendError(webSocket, `Unknown message type: ${message.type}`);
        }
    }

    private async handleSubscribe(webSocket: WebSocket, session: SessionData, message: SyncMessage) {
        const tables = message.tables || [];

        for (const table of tables) {
            session.subscribedTables.add(table);
        }

        // Update attachment for hibernation
        webSocket.serializeAttachment({
            id: session.id,
            subscribedTables: Array.from(session.subscribedTables),
        });

        // Send current state for each subscribed table
        for (const table of tables) {
            const rows = await this.getTableData(table);
            const fullSyncMessage: SyncMessage = {
                type: "fullSync",
                table,
                rows,
            };
            webSocket.send(JSON.stringify(fullSyncMessage));
        }

        // Send ack
        if (message.messageId) {
            const ack: SyncMessage = {
                type: "ack",
                messageId: message.messageId,
            };
            webSocket.send(JSON.stringify(ack));
        }
    }

    private async handleUnsubscribe(session: SessionData, message: SyncMessage) {
        const tables = message.tables || [];

        for (const table of tables) {
            session.subscribedTables.delete(table);
        }
    }

    private async handleDelta(webSocket: WebSocket, session: SessionData, message: SyncMessage) {
        const table = message.table;
        const changes = message.changes || [];

        if (!table) {
            this.sendError(webSocket, "Delta message requires 'table' field");
            return;
        }

        // Apply changes to storage
        for (const change of changes) {
            await this.applyChange(table, change);
        }

        // Broadcast to other subscribed clients
        this.broadcastDelta(webSocket, table, changes, session.id);

        // Send ack
        if (message.messageId) {
            const ack: SyncMessage = {
                type: "ack",
                messageId: message.messageId,
            };
            webSocket.send(JSON.stringify(ack));
        }
    }

    private async applyChange(table: string, change: RowChange) {
        const key = `${table}:${change.rowId}`;

        switch (change.operation) {
            case "insert":
            case "update":
                if (change.data) {
                    await this.ctx.storage.put(key, change.data);
                }
                break;

            case "delete":
                await this.ctx.storage.delete(key);
                break;
        }
    }

    private async getTableData(table: string): Promise<Record<string, Record<string, unknown>>> {
        const prefix = `${table}:`;
        const entries = await this.ctx.storage.list({ prefix });
        const rows: Record<string, Record<string, unknown>> = {};

        for (const [key, value] of entries) {
            const rowId = key.slice(prefix.length);
            rows[rowId] = value as Record<string, unknown>;
        }

        return rows;
    }

    private broadcastDelta(sender: WebSocket, table: string, changes: RowChange[], senderId: string) {
        const deltaMessage: SyncMessage = {
            type: "delta",
            table,
            changes,
            clientId: senderId, // Include sender ID so clients can ignore their own changes
        };
        const messageStr = JSON.stringify(deltaMessage);

        for (const [ws, session] of this.sessions) {
            // Don't send back to sender
            if (ws === sender) continue;

            // Only send to clients subscribed to this table
            if (!session.subscribedTables.has(table)) continue;

            try {
                ws.send(messageStr);
            } catch (error) {
                console.error("Failed to send to client:", error);
            }
        }
    }

    private sendError(webSocket: WebSocket, errorMessage: string) {
        const error: SyncMessage = {
            type: "error",
            error: errorMessage,
        };
        webSocket.send(JSON.stringify(error));
    }

    async webSocketClose(webSocket: WebSocket, code: number, reason: string, wasClean: boolean) {
        this.sessions.delete(webSocket);
        webSocket.close(code, "Connection closed");
    }
}
