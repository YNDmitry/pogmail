import type { Page } from "@playwright/test";
import type { MessageDetail } from "../src/shared/contract/mail";

export function mail(overrides: Partial<MessageDetail> = {}): MessageDetail {
	return {
		id: "message", mailboxId: "mailbox", threadId: "thread", direction: "inbound",
		status: "received", folderId: null, subject: "Invoice", fromAddress: "sender@example.test",
		fromName: "Sender", toAddresses: [{ address: "reader@example.test" }], snippet: "Preview",
		read: true, starred: false, snoozedUntil: null, hasAttachments: false, sizeBytes: 100,
		receivedAt: "2026-09-29T04:16:00Z", messageId: null, inReplyTo: null,
		ccAddresses: [], bccAddresses: [], replyTo: null, bodyText: "Invoice body", bodyHtml: null,
		rawKey: null, attachments: [], delivery: null, ...overrides,
	};
}

/** Mock only the HTTP boundary; never sends mail or needs a real account. */
export async function mailApp(page: Page, items = [mail()]) {
	const state = {
		items, mailLayout: "messages" as "messages" | "conversations",
		failList: false, failNext: false, failRead: false, failSave: false, failPatch: false, failSend: false,
		saveGate: undefined as Promise<void> | undefined,
		creates: 0, writes: [] as Array<Record<string, unknown>>, sentWrites: [] as Array<Record<string, unknown>>, searches: [] as string[],
		searchResults: undefined as MessageDetail[] | undefined,
	};
	const responses: Record<string, unknown> = {
		"/api/auth/me": {
			id: "reader", email: "reader@example.test", name: "Reader", role: "user",
			avatarKey: null, get mailLayout() { return state.mailLayout; }, telegramChatId: null, canManageMailboxes: false,
		},
		"/api/branding": { appName: "Pogmail" },
		"/api/mailboxes": { items: [{
			id: "mailbox", address: "reader@example.test", localPart: "reader", displayName: null,
			avatarKey: null, type: "personal", source: "cloudflare", disabled: false, permission: "full_access",
		}] },
		"/api/folders": { items: [{ id: "receipts", mailboxId: "mailbox", name: "Receipts", color: null, position: 0 }] },
		"/api/templates": { items: [] },
		"/api/messages/counts": { byStatus: {}, byMailbox: {}, byFolder: {}, starred: 0 },
	};
	await page.route("**/api/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		const method = request.method();
		const fail = () => route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
		if (path === "/api/send" && method === "POST") {
			const payload = request.postDataJSON();
			state.sentWrites.push(payload);
			if (state.failSend) return fail();
			state.items.push(mail({ ...payload, id: `sent-${state.sentWrites.length}`, direction: "outbound", status: "sent",
				fromAddress: "reader@example.test", fromName: "Reader", toAddresses: payload.to, receivedAt: new Date().toISOString() }));
			return route.fulfill({ json: { ok: true } });
		}
		if (path.startsWith("/api/send/drafts") && (method === "POST" || method === "PUT")) {
			const payload = request.postDataJSON();
			if (method === "POST") state.creates++;
			state.writes.push(payload);
			await state.saveGate;
			if (state.failSave) return fail();
			const id = method === "POST" ? `draft-${state.creates}` : path.split("/").at(-1)!;
			const fields = { ...payload, toAddresses: payload.to ?? [], ccAddresses: payload.cc ?? [], bccAddresses: payload.bcc ?? [] };
			const existing = state.items.find((item) => item.id === id);
			if (existing) Object.assign(existing, fields);
			else state.items.push(mail({ ...fields, id, direction: "outbound", status: "draft", fromAddress: "reader@example.test", fromName: "Reader" }));
			return route.fulfill({ json: { id } });
		}
		if (path === "/api/messages" && method === "GET") {
			const cursor = url.searchParams.get("cursorId");
			if (cursor ? state.failNext : state.failList) return fail();
			const search = url.searchParams.get("search");
			if (search) state.searches.push(search);
			const filtered = (search && state.searchResults ? state.searchResults : state.items).filter((item) =>
				(!url.searchParams.has("status") || item.status === url.searchParams.get("status")) &&
				(!url.searchParams.has("inbox") || item.folderId === null),
			);
			const start = cursor ? filtered.findIndex((item) => item.id === cursor) + 1 : 0;
			const pageItems = filtered.slice(start, start + 2);
			const last = start + 2 < filtered.length ? pageItems.at(-1) : undefined;
			return route.fulfill({ json: {
				items: pageItems, nextCursor: last ? new Date(last.receivedAt).getTime() : null,
				nextCursorId: last?.id ?? null,
			} });
		}
		if (path.startsWith("/api/messages/") && !responses[path]) {
			const id = path.split("/")[3];
			const item = state.items.find((entry) => entry.id === id);
			if (method === "PATCH") {
				if (state.failPatch) return fail();
				const payload = request.postDataJSON();
				const fields = { ...payload, ...("snoozedUntil" in payload ? {
					snoozedUntil: payload.snoozedUntil == null ? null : new Date(payload.snoozedUntil).toISOString(),
				} : {}) };
				if (id === "bulk") {
					for (const entry of state.items) if (payload.ids.includes(entry.id)) Object.assign(entry, fields);
					return route.fulfill({ json: { updated: payload.ids.length } });
				}
				if (item) {
					Object.assign(item, fields);
					return route.fulfill({ json: item });
				}
			}
			if (state.failRead) return fail();
			if (item) return route.fulfill({ json: path.endsWith("/thread") ? {
				items: state.items.filter((entry) => entry.mailboxId === item.mailboxId && entry.threadId === item.threadId)
					.toSorted((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
			} : item });
			return route.fulfill({ status: 404, json: { error: "Message not found" } });
		}
		if (responses[path]) return route.fulfill({ json: responses[path] });
		return route.abort();
	});
	return state;
}
