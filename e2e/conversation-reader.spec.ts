import { expect, test, type Page } from "@playwright/test";
import { mail, mailApp } from "./mail-fixture";

async function startReply(page: Page) {
	const reply = page.getByRole("region", { name: "Reply", exact: true });
	await reply.getByRole("button", { name: "Reply", exact: true }).click();
	const editor = reply.locator("[contenteditable=true]");
	await expect(editor).toBeFocused();
	return editor;
}

const older = mail({ id: "older", fromName: "Alice", read: true, bodyText: "Older message body", receivedAt: "2026-09-28T10:00:00Z" });
const latest = mail({ id: "latest", fromName: "Bob", read: true, bodyText: "Latest message body\n\n> Quoted old content", receivedAt: "2026-09-29T10:00:00Z" });

test("a conversation expands messages inline without navigation or duplicate bodies", async ({ page }) => {
	const state = await mailApp(page, [older, latest]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	const oldCard = page.locator('[data-thread-message="older"]');
	const latestCard = page.locator('[data-thread-message="latest"]');
	await expect(latestCard.getByText("Latest message body", { exact: true })).toBeVisible();
	await expect(page.getByText("Older message body", { exact: true })).toBeHidden();
	await oldCard.getByRole("button", { name: /Expand message/ }).click();
	await expect(oldCard.getByText("Older message body", { exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/mail\/inbox\/latest$/);
	await oldCard.getByRole("button", { name: /Collapse message/ }).focus();
	await page.keyboard.press("Enter");
	await expect(oldCard.getByText("Older message body", { exact: true })).toBeHidden();
	await expect(page.getByText("Latest message body", { exact: true })).toHaveCount(1);
	await expect(page.getByText("Quoted old content", { exact: false })).toBeHidden();
	await latestCard.getByRole("button", { name: "Show quoted text" }).click();
	await expect(page.getByText("Quoted old content", { exact: false })).toBeVisible();
});

test("unread older messages are expanded and marked read only when displayed", async ({ page }) => {
	const state = await mailApp(page, [{ ...older, read: false }, latest]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	await expect(page.locator('[data-thread-message="older"]').getByText("Older message body", { exact: true })).toBeVisible();
	await expect.poll(() => state.items[0]!.read).toBe(true);
	// Marking it read must not immediately collapse it.
	await expect(page.getByText("Older message body", { exact: true })).toBeVisible();
});

test("a failed expanded message can be retried without replacing the thread", async ({ page }) => {
	const state = await mailApp(page, [older, latest]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	await expect(page.locator('[data-thread-message="latest"]')).toBeVisible();
	state.failRead = true;
	const oldCard = page.locator('[data-thread-message="older"]');
	await oldCard.getByRole("button", { name: /Expand message/ }).click();
	await expect(oldCard.getByText("Could not load this message", { exact: true })).toBeVisible();
	state.failRead = false;
	await oldCard.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(oldCard.getByText("Older message body", { exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/mail\/inbox\/latest$/);
});

test("replying after an outgoing message targets the correspondent, not yourself", async ({ page }) => {
	const incoming = { ...older, replyTo: "support@example.test" };
	const outgoing = { ...latest, direction: "outbound" as const, status: "sent" as const, fromAddress: "reader@example.test", toAddresses: [{ address: "sender@example.test" }] };
	const state = await mailApp(page, [incoming, outgoing]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/older");
	await startReply(page);
	await expect(page.getByLabel("Reply to support@example.test", { exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Full composer" }).click();
	await expect(page).toHaveURL(/replyTo=older/);
	await expect(page.getByLabel("To", { exact: true })).toHaveValue("support@example.test");
});

test("long histories focus the latest message, with a visible subject and compact HTML quotes", async ({ page }) => {
	const history = Array.from({ length: 25 }, (_, i) => mail({ id: `old-${i}`, receivedAt: `2026-09-28T${String(i % 24).padStart(2, "0")}:00:00Z` }));
	const html = `<p>Current HTML reply</p><blockquote>${"<p>Quoted history</p>".repeat(80)}</blockquote>`;
	const state = await mailApp(page, [...history, { ...latest, bodyHtml: html }]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	const card = page.locator('[data-thread-message="latest"]');
	const frame = card.locator("iframe");
	await expect(card.getByRole("button", { name: /Collapse message/ })).toBeInViewport();
	await expect(page.getByRole("heading", { name: "Invoice", exact: true })).toBeInViewport();
	await expect(card.frameLocator("iframe").getByText("Current HTML reply")).toBeVisible();
	await expect(card.frameLocator("iframe").locator("blockquote")).toBeHidden();
	await expect.poll(() => frame.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(200);
	await card.getByRole("button", { name: "Show quoted text" }).click();
	await expect(card.frameLocator("iframe").locator("blockquote")).toBeVisible();
	await expect.poll(() => frame.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(1000);
	await card.getByRole("button", { name: "Hide quoted text" }).click();
	await expect.poll(() => frame.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(200);
	await expect.poll(() => page.getByRole("region", { name: "Message reader", exact: true }).evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
});

test("conversation archive and undo cover unloaded members but leave other locations alone", async ({ page }) => {
	const sent = mail({ id: "sent-copy", direction: "outbound", status: "sent" });
	const filed = mail({ id: "filed-copy", folderId: "receipts" });
	const state = await mailApp(page, [{ ...latest }, sent, { ...older }, filed]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox");
	await expect(page.locator("[data-message]")).toHaveCount(1);
	await page.locator('[data-message="latest"]').hover();
	await page.locator('[data-message="latest"]').getByRole("button", { name: "Archive", exact: true }).click();
	await expect.poll(() => state.items.filter((item) => item.status === "archived").map((item) => item.id).toSorted()).toEqual(["latest", "older"]);
	await expect(page.locator("[data-message]")).toHaveCount(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect.poll(() => state.items.filter((item) => item.status === "received" && !item.folderId).length).toBe(2);
	expect(state.items.find((item) => item.id === sent.id)?.status).toBe("sent");
	expect(state.items.find((item) => item.id === filed.id)?.folderId).toBe("receipts");
});

test("mailbox copies never merge and older-message selection highlights the conversation", async ({ page }, testInfo) => {
	const state = await mailApp(page, [{ ...latest }, mail({ id: "other-copy", mailboxId: "other-mailbox" }), { ...older }]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox");
	await expect(page.locator("[data-message]")).toHaveCount(2);
	await page.getByRole("button", { name: "Load more", exact: true }).click();
	await expect(page.locator("[data-message]")).toHaveCount(2);
	await page.goto("/mail/inbox/older");
	await expect(page.locator('[data-thread-message="older"]').getByText("Older message body", { exact: true })).toBeVisible();
	if (testInfo.project.name === "chromium") {
		await expect(page.locator('[data-message="latest"] a')).toHaveAttribute("aria-current", "page");
		await expect(page.locator('[data-message="other-copy"] a')).not.toHaveAttribute("aria-current", "page");
	}
});

test("unsent inline replies block navigation and can be explicitly discarded", async ({ page }, testInfo) => {
	const state = await mailApp(page, [{ ...latest }, mail({ id: "other-thread", threadId: "other-thread", subject: "Other conversation" })]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	const editor = await startReply(page);
	await editor.fill("Keep this unsent reply");
	const leave = testInfo.project.name === "mobile" ? page.getByRole("link", { name: "Back to messages", exact: true }) : page.locator('[data-message="other-thread"] a');
	await leave.click();
	const dialog = page.getByRole("dialog", { name: "Discard unsent reply?", exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Keep writing", exact: true }).click();
	await expect(editor).toContainText("Keep this unsent reply");
	await leave.click();
	await dialog.getByRole("button", { name: "Discard reply", exact: true }).click();
	await expect(page).not.toHaveURL(/\/mail\/inbox\/latest$/);
	expect(state.sentWrites).toHaveLength(0);
});

test("full composer carries the inline reply through a saved draft and preserves it on save failure", async ({ page }) => {
	const state = await mailApp(page, [{ ...latest }]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	const editor = await startReply(page);
	await editor.fill("Handed over reply");
	state.failSave = true;
	await page.getByRole("button", { name: "Full composer", exact: true }).click();
	await expect(page.getByText("Could not open the composer", { exact: true })).toBeVisible();
	await expect(editor).toContainText("Handed over reply");
	state.failSave = false;
	await page.getByRole("button", { name: "Full composer", exact: true }).click();
	await expect(page).toHaveURL(/draftId=draft-2/);
	await expect(page.getByLabel("To", { exact: true })).toHaveValue("sender@example.test");
	await expect(page.getByLabel("Message", { exact: true }).locator("[contenteditable=true]")).toContainText("Handed over reply");
	expect(state.sentWrites).toHaveLength(0);
});

test("incoming mail cannot unmount or silently retarget an active inline reply", async ({ page }) => {
	const original = { ...latest, messageId: "original@sender.test" };
	const state = await mailApp(page, [original]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	const editor = await startReply(page);
	await editor.fill("This is still for Bob");
	const incoming = mail({ id: "new", fromAddress: "new-correspondent@example.test", receivedAt: "2026-09-30T10:00:00Z" });
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	await page.route("**/api/messages/new", async (route) => {
		await gate;
		await route.fulfill({ json: incoming });
	});
	state.items.push(incoming);
	await page.locator("[data-conversation-toolbar]").getByRole("button", { name: "Add star", exact: true }).click();
	await expect(page.locator('[data-thread-message="new"]')).toBeVisible();
	await expect(editor).toContainText("This is still for Bob");
	release();
	await expect(page.locator('[data-thread-message="new"]').getByText("Invoice body", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Reply to sender@example.test", { exact: true })).toBeVisible();
	await expect(editor).toContainText("This is still for Bob");
	await page.getByRole("region", { name: "Reply", exact: true }).getByRole("button", { name: "Send", exact: true }).click();
	await expect.poll(() => state.sentWrites.length).toBe(1);
	expect(state.sentWrites[0]).toMatchObject({ to: [{ address: "sender@example.test" }], inReplyTo: original.messageId, bodyText: "This is still for Bob" });
	await expect(editor).toBeEmpty();
	await expect(editor).toBeFocused();
});

test("the reply editor stays deferred and can be closed without disturbing reading", async ({ page }) => {
	const state = await mailApp(page, [{ ...latest }]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	const reply = page.getByRole("region", { name: "Reply", exact: true });
	await expect(reply.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
	await expect(reply.locator("[contenteditable=true]")).toHaveCount(0);
	await startReply(page);
	await reply.getByRole("button", { name: "Cancel reply", exact: true }).click();
	await expect(reply.locator("[contenteditable=true]")).toHaveCount(0);
	await expect(reply.getByRole("button", { name: "Reply", exact: true })).toBeFocused();
});

test("failed sending leaves the inline reply editable and retryable", async ({ page }) => {
	const state = await mailApp(page, [{ ...latest }]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	const editor = await startReply(page);
	await editor.fill("Keep this failed reply");
	state.failSend = true;
	const send = page.getByRole("region", { name: "Reply", exact: true }).getByRole("button", { name: "Send", exact: true });
	await send.click();
	await expect(page.getByText("Could not send the reply", { exact: true })).toBeVisible();
	await expect(editor).toContainText("Keep this failed reply");
	state.failSend = false;
	await send.click();
	await expect(editor).toBeEmpty();
	expect(state.sentWrites).toHaveLength(2);
});

test("read, star and snooze controls update the conversation's current-location members", async ({ page }) => {
	const state = await mailApp(page, [{ ...latest }, { ...older }]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox");
	const row = page.locator('[data-message="latest"]');
	await row.hover();
	await row.getByRole("button", { name: "Mark as unread", exact: true }).click();
	await expect.poll(() => state.items.every((item) => !item.read)).toBe(true);
	await row.getByRole("button", { name: "Mark as read", exact: true }).click();
	await expect.poll(() => state.items.every((item) => item.read)).toBe(true);
	await row.getByRole("button", { name: "Add star", exact: true }).click();
	await expect.poll(() => state.items.every((item) => item.starred)).toBe(true);
	await page.goto("/mail/inbox/latest");
	await page.getByRole("combobox", { name: "Snooze", exact: true }).click();
	await page.getByRole("option", { name: "Tomorrow", exact: true }).click();
	await expect.poll(() => state.items.every((item) => new Date(item.snoozedUntil ?? 0).getTime() > Date.now())).toBe(true);
});

test("quoted-only mail stays visible and unsent drafts never appear as sent history", async ({ page }) => {
	const message = { ...latest, bodyHtml: "<html><head><style>p{color:black}</style></head><body><blockquote>Only quoted content</blockquote></body></html>" };
	const draft = mail({ id: "unsent", direction: "outbound", status: "draft", bodyText: "Private unsent draft", receivedAt: "2026-09-30T10:00:00Z" });
	const state = await mailApp(page, [message, draft]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest");
	await expect(page.locator('[data-thread-message="latest"]').frameLocator("iframe").getByText("Only quoted content")).toBeVisible();
	await expect(page.locator('[data-thread-message="unsent"]')).toHaveCount(0);
	await expect(page.getByText("Private unsent draft", { exact: true })).toHaveCount(0);
});

test("search does not hide matching text inside quoted history", async ({ page }) => {
	const state = await mailApp(page, [{ ...latest, bodyHtml: "<p>New reply</p><blockquote>Quoted old content</blockquote>" }]);
	state.mailLayout = "conversations";
	await page.goto("/mail/inbox/latest?q=Quoted+old+content");
	const frame = page.locator('[data-thread-message="latest"] iframe');
	await expect(frame.contentFrame().getByText("Quoted old content", { exact: true })).toBeVisible();
	await expect.poll(async () => (await frame.boundingBox())?.height ?? 1000).toBeLessThan(180);
});
