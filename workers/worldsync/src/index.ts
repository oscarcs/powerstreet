import { DurableObject } from "cloudflare:workers";

export default {
    async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
        return new Response("WorldSync Worker is running.");
    }
};

export class WorldSyncDurableObject extends DurableObject {
    sessions: Map<WebSocket, { [key: string]: any }>;

    constructor(ctx: DurableObjectState, env: any) {
        super(ctx, env);
        this.sessions = new Map();
    }
}