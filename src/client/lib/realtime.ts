/**
 * Reconnecting WebSocket to the user's Durable Object. The server only ever pushes,
 * so the client's sole job is to stay connected and hand events to the caller.
 */
export function connectRealtime(
	onEvent: (event: RealtimeEvent) => void,
	onConnected?: () => void,
): () => void {
	let socket: WebSocket | null = null;
	let closed = false;
	let attempt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const open = () => {
		if (closed) return;

		const url = new URL("/api/realtime", location.href);
		url.protocol = url.protocol.replace("http", "ws");
		socket = new WebSocket(url);

		socket.addEventListener("open", () => {
			if (closed) return;
			attempt = 0;
			onConnected?.();
		});

		socket.addEventListener("message", (event) => {
			if (event.data === "pong") return;
			try {
				onEvent(JSON.parse(event.data as string) as RealtimeEvent);
			} catch {
				// A malformed frame is not worth tearing the connection down for.
			}
		});

		socket.addEventListener("close", () => {
			if (closed) return;
			// Capped exponential backoff so a server restart is not a thundering herd.
			timer = setTimeout(open, Math.min(1000 * 2 ** attempt++, 30_000));
		});
	};

	open();

	return () => {
		closed = true;
		clearTimeout(timer);
		socket?.close();
	};
}

export type RealtimeEvent =
	| { type: "message.new"; mailboxId: string; messageId: string }
	| { type: "message.sent"; mailboxId: string; messageId: string }
	| { type: "message.delivery"; mailboxId: string; messageId: string }
	| { type: "message.changed"; mailboxId: string }
	| { type: "message.deleted"; mailboxId: string }
	| { type: "contacts.changed" }
	| { type: "campaigns.changed" }
	| { type: "calendar.changed" }
	| { type: "backups.changed" }
	| { type: "domain.changed"; domainId: string }
	| { type: "admin.overview" };
