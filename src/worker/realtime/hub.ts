import { DurableObject } from "cloudflare:workers";

import type { RealtimeEvent } from "./notify";

/**
 * One instance per user, addressed by user id. Holds the WebSocket fan-out for that
 * user's open tabs. Hibernation is on, so an idle tab costs no duration billing.
 */
export class RealtimeHub extends DurableObject<Env> {
	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade") !== "websocket") {
			return new Response("Expected WebSocket", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

		this.ctx.acceptWebSocket(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	/** Called over RPC from the queue consumer, not over HTTP. */
	broadcast(event: RealtimeEvent): void {
		const payload = JSON.stringify(event);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(payload);
			} catch {
				// A socket that died between getWebSockets() and send() is not an error.
			}
		}
	}

	override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
		// The client only ever pings; everything else flows server to client.
		if (message === "ping") ws.send("pong");
	}

	override webSocketClose(ws: WebSocket, code: number, reason: string): void {
		ws.close(code === 1006 ? 1000 : code, reason);
	}
}
