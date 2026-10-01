import { expect, test } from "@playwright/test";
import type { MessageDetail } from "../src/shared/contract/mail";

const original: MessageDetail = {
	id: "original", mailboxId: "mailbox", threadId: "thread", direction: "inbound",
	status: "received", folderId: null, subject: "Original subject",
	fromAddress: "sender@example.test", fromName: "Sender",
	toAddresses: [{ address: "reader@example.test" }], snippet: "Original body",
	read: true, starred: false, snoozedUntil: null, hasAttachments: false,
	sizeBytes: 100, receivedAt: "2026-09-29T04:16:00Z", messageId: "<original@example.test>",
	inReplyTo: null, ccAddresses: null, bccAddresses: null, replyTo: null,
	bodyText: "Original body", bodyHtml: null, rawKey: null, attachments: [], delivery: null,
};

for (const reply of [false, true]) {
	test(`autosave preserves the mounted ${reply ? "reply" : "new message"} and focused field`, async ({ page }) => {
		let draft: MessageDetail | undefined;
		let creates = 0;
		const updates: unknown[] = [];
		const responses: Record<string, unknown> = {
			"/api/auth/me": {
				id: "reader", email: "reader@example.test", name: "Reader", role: "user",
				avatarKey: null, mailLayout: "messages", telegramChatId: null, canManageMailboxes: false,
			},
			"/api/branding": { appName: "Pogmail" },
			"/api/mailboxes": { items: [{
				id: "mailbox", address: "reader@example.test", localPart: "reader", displayName: null,
				avatarKey: null, type: "personal", source: "cloudflare", disabled: false, permission: "full_access",
			}] },
			"/api/folders": { items: [] },
			"/api/templates": { items: [] },
			"/api/messages/counts": { byStatus: {}, byMailbox: {}, byFolder: {}, starred: 0 },
			"/api/messages": { items: [], nextCursor: null },
			"/api/messages/original": original,
		};
		await page.route("**/api/**", async (route) => {
			const request = route.request();
			const path = new URL(request.url()).pathname;
			if (path === "/api/send/drafts" && request.method() === "POST") {
				creates++;
				draft = { ...original, ...request.postDataJSON(), id: "saved-draft", status: "draft" };
				await route.fulfill({ json: { id: draft.id } });
			} else if (path === "/api/send/drafts/saved-draft" && request.method() === "PUT") {
				updates.push(request.postDataJSON());
				draft = { ...draft!, ...request.postDataJSON() };
				await route.fulfill({ json: { id: draft.id } });
			} else if (path === "/api/messages/saved-draft" && draft) {
				await route.fulfill({ json: draft });
			} else if (responses[path]) {
				await route.fulfill({ json: responses[path] });
			} else {
				await route.abort();
			}
		});
		await page.goto(reply ? "/compose?replyTo=original" : "/compose");
		const editor = page.locator(".maily-compose-editor .ProseMirror");
		const subject = page.getByLabel("Subject", { exact: true });
		await expect(editor).toBeVisible();
		const mountedEditor = await editor.elementHandle();
		const mountedSubject = await subject.elementHandle();
		await subject.fill("Autosave without refresh");
		await expect(page).toHaveURL(/\/compose\?draftId=saved-draft/);
		await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
		expect(await mountedEditor!.evaluate((element) => element.isConnected)).toBe(true);
		expect(await mountedSubject!.evaluate((element) => element.isConnected)).toBe(true);
		await expect(subject).toBeFocused();
		await expect(subject).toHaveValue("Autosave without refresh");
		if (reply) {
			await expect(editor).toContainText("Original body");
			await expect(page.getByText("Replying to")).toBeVisible();
		}

		await editor.fill("Keep this editor mounted");
		await expect.poll(() => updates.length).toBeGreaterThan(0);
		await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
		expect(creates).toBe(1);
		expect(draft?.subject).toBe("Autosave without refresh");
		expect(draft?.bodyHtml).toContain("Keep this editor mounted");
		if (reply) {
			expect(draft?.inReplyTo).toBe(original.messageId);
			expect(draft?.threadId).toBe(original.threadId);
		}

		// A reload still opens the saved draft; starting another message must not reuse it.
		await page.reload();
		await expect(subject).toHaveValue("Autosave without refresh");
		await expect(editor).toContainText("Keep this editor mounted");
		await page.goto("/mail/inbox");
		await page.getByRole("link", { name: "Write a message" }).click();
		await expect(subject).toHaveValue("");
		await expect(editor).toHaveText("");
	});
}
