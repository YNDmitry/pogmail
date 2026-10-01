import { expect, test } from "@playwright/test";
import type { MessageDetail } from "../src/shared/contract/mail";

const message: MessageDetail = {
	id: "layout-message",
	mailboxId: "layout-mailbox",
	threadId: "layout-thread",
	direction: "inbound",
	status: "received",
	folderId: null,
	subject: "Row action layout",
	fromAddress: "sender@example.test",
	fromName: "A very long sender name that must not overlap the row actions",
	toAddresses: [{ address: "reader@example.test" }],
	snippet: "Layout regression check",
	read: true,
	starred: false,
	snoozedUntil: null,
	hasAttachments: true,
	sizeBytes: 100,
	receivedAt: "2026-09-29T04:16:00Z",
	messageId: null,
	inReplyTo: null,
	ccAddresses: null,
	bccAddresses: null,
	replyTo: null,
	bodyText: "Message body",
	bodyHtml: null,
	rawKey: null,
	attachments: [],
	delivery: null,
};
const messages = [message, { ...message, id: "starred-message", starred: true }];

test("row actions do not overlap metadata or long senders", async ({ page, isMobile }) => {
	// Read-only fixtures: no credentials or mailbox changes required.
	const responses: Record<string, unknown> = {
		"/api/auth/me": {
			id: "layout-user", email: "reader@example.test", name: "Reader", role: "user",
			avatarKey: null, mailLayout: "messages", telegramChatId: null, canManageMailboxes: false,
		},
		"/api/branding": { appName: "Pogmail" },
		"/api/mailboxes": { items: [] },
		"/api/folders": { items: [] },
		"/api/messages/counts": { byStatus: { received: 2 }, byMailbox: {}, byFolder: {}, starred: 1 },
		"/api/messages": { items: messages, nextCursor: null },
		[`/api/messages/${message.id}`]: message,
		[`/api/messages/${message.id}/thread`]: { items: [message] },
	};
	await page.route("**/api/**", (route) => {
		const data = responses[new URL(route.request().url()).pathname];
		return data ? route.fulfill({ json: data }) : route.abort();
	});
	await page.goto(isMobile ? "/mail/inbox" : `/mail/inbox/${message.id}`);
	if (!isMobile) await expect(page.locator("article")).toBeVisible();

	for (const width of isMobile ? [393, 1024] : [1024, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		for (const mail of messages) {
			const row = page.locator(`[data-message="${mail.id}"]`);
			const link = row.getByRole("link");
			const action = row.getByRole("button", { name: "Mark as unread" });
			const date = row.locator("time");
			const attachment = row.getByLabel("Has attachments");
			await expect(link).toBeVisible();

			if (isMobile) {
				await expect(date).toBeVisible();
				await expect(attachment).toBeVisible();
				await expect(action).toHaveCSS("opacity", "1");
				const summary = (await link.boundingBox())!;
				const button = (await action.boundingBox())!;
				expect(button.y).toBeGreaterThanOrEqual(summary.y + summary.height);
			} else {
				await page.mouse.move(0, 0);
				await expect(date).toBeVisible();
				await expect(attachment).toBeVisible();
				await action.focus();
				for (const state of ["focus", "hover"]) {
					if (state === "hover") {
						await action.evaluate((element) => element.blur());
						await link.hover();
					}
					await expect(action).toHaveCSS("opacity", "1");
					await expect(date).toBeHidden();
					await expect(attachment).toBeHidden();
					const sender = (await link.getByText(mail.fromName!).boundingBox())!;
					const button = (await action.boundingBox())!;
					expect(sender.x + sender.width).toBeLessThanOrEqual(button.x);
				}
				await page.mouse.move(0, 0);
				await expect(date).toBeVisible();
				await expect(attachment).toBeVisible();
			}
		}
	}
});
