import { DurableObject } from "cloudflare:workers";

export default {
    async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
        if (request.url.endsWith("/websocket")) {
            const upgradeHeader = request.headers.get("Upgrade");
            if (!upgradeHeader || upgradeHeader !== "websocket") {
                return new Response("Worker expected Upgrade: websocket", { status: 426 });
            }

            if (request.method !== "GET") {
                return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
            }

            let stub = env.WORLDSYNC_DO.getByName("default");
            return stub.fetch(request);
        }

        return new Response(`Supported endpoints: /websocket: expects a WebSocket Upgrade request`, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
};

export class WorldSyncDurableObject extends DurableObject {
    sessions: Map<WebSocket, { [key: string]: string }>;

    constructor(ctx: DurableObjectState, env: any) {
        super(ctx, env);
        this.sessions = new Map();

        this.ctx.getWebSockets().forEach((webSocket) => {
            let attachment = webSocket.deserializeAttachment();
            if (attachment) {
                this.sessions.set(webSocket, attachment);
            }
        });

        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    async fetch(request: Request): Promise<Response> {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        // Accept the WebSocket connection in a 'hibernatable' way
        this.ctx.acceptWebSocket(server);

        const id = crypto.randomUUID();

        server.serializeAttachment({ id });
        this.sessions.set(server, { id });

        return new Response(null, { status: 101, webSocket: client } );
    }

    async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer) {
        const session = this.sessions.get(webSocket);

        // TODO: Handle incoming messages from the client
    }

    async webSocketClose(webSocket: WebSocket, code: number, reason: string, wasClean: boolean) {
        this.sessions.delete(webSocket);
        webSocket.close(code, 'Connection closed');
    }
}