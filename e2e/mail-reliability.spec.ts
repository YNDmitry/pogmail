import { expect, test } from "@playwright/test";
import { mail, mailApp } from "./mail-fixture";

test("failed Save and leave keeps the draft open until retry succeeds", async ({ page, isMobile }) => {
	const state = await mailApp(page);
	state.failSave = true;
	await page.goto("/compose");
	await page.getByLabel("Subject", { exact: true }).fill("Do not lose this subject");
	if (isMobile) await page.getByRole("button", { name: "Navigation", exact: true }).click();
	await page.getByRole("link", { name: "Inbox", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
	await dialog.getByRole("button", { name: "Save and leave" }).click();
	await expect(dialog).toBeVisible();
	await expect(page).toHaveURL(/\/compose/);
	await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Do not lose this subject");
	state.failSave = false;
	await dialog.getByRole("button", { name: "Save and leave" }).click();
	await expect(page).toHaveURL(/\/mail\/inbox$/);
});

test("load more preserves older mail and offers a retry when the next page fails", async ({ page }) => {
	const state = await mailApp(page, [mail({ id: "new" }), mail({ id: "middle" }), mail({ id: "old", subject: "Older invoice" })]);
	state.failNext = true;
	await page.goto("/mail/inbox");
	await expect(page.locator("[data-message]")).toHaveCount(2);
	await page.getByRole("button", { name: "Load more" }).click();
	await expect(page.getByText("Could not load more mail", { exact: true })).toBeVisible();
	await expect(page.locator("[data-message]")).toHaveCount(2);
	state.failNext = false;
	await page.getByRole("button", { name: "Retry loading more" }).click();
	await expect(page.locator("[data-message]")).toHaveCount(3);
	await expect(page.getByRole("link", { name: /Older invoice/ })).toBeVisible();
});

test("a failed list is not an empty inbox and can be retried", async ({ page }) => {
	const state = await mailApp(page);
	state.failList = true;
	await page.goto("/mail/inbox");
	await expect(page.getByText("Could not load mail", { exact: true })).toBeVisible();
	await expect(page.getByText("Nothing waiting", { exact: true })).toBeHidden();
	state.failList = false;
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(page.locator("[data-message]")).toHaveCount(1);
});

test("save and close waits for a slow autosave and persists edits made during it", async ({ page }) => {
	const state = await mailApp(page, []);
	let release!: () => void;
	state.saveGate = new Promise<void>((resolve) => { release = resolve; });
	await page.goto("/compose");
	const subject = page.getByLabel("Subject", { exact: true });
	await subject.fill("First version");
	await expect.poll(() => state.writes.length).toBe(1);
	await subject.fill("Latest version");
	await page.getByRole("button", { name: "Save and close", exact: true }).click();
	release();
	await expect(page).toHaveURL(/\/mail\/drafts$/);
	expect(state.creates).toBe(1);
	await page.getByRole("link", { name: /Latest version/ }).click();
	await expect(subject).toHaveValue("Latest version");
});

test("a failed autosave retains edits and saves them on reconnect", async ({ page, context }) => {
	const state = await mailApp(page, []);
	await page.goto("/compose");
	await expect(page.getByLabel("Subject", { exact: true })).toBeVisible();
	state.failSave = true;
	await context.setOffline(true);
	await page.getByLabel("Subject", { exact: true }).fill("Written offline");
	await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
	await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Written offline");
	state.failSave = false;
	await context.setOffline(false);
	await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
	expect(state.items.at(-1)?.subject).toBe("Written offline");
});

for (const action of ["Archive", "Move to trash"]) {
	test(`${action} can be undone from the list`, async ({ page }) => {
		await mailApp(page);
		await page.goto("/mail/inbox");
		const row = page.locator("[data-message]");
		await row.hover();
		await row.getByRole("button", { name: action, exact: true }).click();
		await expect(row).toHaveCount(0);
		const undo = page.getByRole("button", { name: "Undo", exact: true });
		await undo.focus();
		await page.keyboard.press("Enter");
		await expect(row).toHaveCount(1);
	});
}

test("a failed archive shows an error and restores the row", async ({ page }) => {
	const state = await mailApp(page);
	state.failPatch = true;
	await page.goto("/mail/inbox");
	const row = page.locator("[data-message]");
	await row.hover();
	await row.getByRole("button", { name: "Archive", exact: true }).click();
	await expect(page.getByText("Could not update the message", { exact: true })).toBeVisible();
	await expect(row).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeHidden();
});

test("archiving in the reader returns to the list and can be undone", async ({ page }) => {
	await mailApp(page);
	await page.goto("/mail/inbox/message");
	await page.locator("article").getByRole("button", { name: "Archive", exact: true }).click();
	await expect(page).toHaveURL(/\/mail\/inbox$/);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator("[data-message]")).toHaveCount(1);
});

test("search filters reach the API and survive reload", async ({ page }) => {
	const state = await mailApp(page, [mail(), mail({ id: "match", subject: "Search result" })]);
	state.searchResults = [state.items[1]!];
	await page.goto("/mail/inbox");
	const query = 'invoice from:sender@example.test has:attachment is:unread';
	await page.getByRole("searchbox", { name: "Search mail" }).fill(query);
	await expect.poll(() => state.searches.at(-1)).toBe(query);
	await expect(page.locator("[data-message]")).toHaveCount(1);
	await page.reload();
	await expect(page.getByRole("searchbox", { name: "Search mail" })).toHaveValue(query);
	await expect(page.getByRole("link", { name: /Search result/ })).toBeVisible();
});

test("a failed reader load offers a retry instead of a blank pane", async ({ page }) => {
	const state = await mailApp(page);
	state.failRead = true;
	await page.goto("/mail/inbox/message");
	await expect(page.getByText("Could not load the message", { exact: true })).toBeVisible();
	state.failRead = false;
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(page.locator("article")).toBeVisible();
});

test("bulk archive and undo restore every selected message", async ({ page }) => {
	await mailApp(page, [mail({ id: "first" }), mail({ id: "second" })]);
	await page.goto("/mail/inbox");
	await expect(page.locator("[data-message]")).toHaveCount(2);
	const picks = page.getByRole("checkbox", { name: "Select mail from Sender", exact: true });
	await picks.nth(0).check();
	await picks.nth(1).check();
	await page.locator("section > header").getByRole("button", { name: "Archive", exact: true }).click();
	await expect(page.locator("[data-message]")).toHaveCount(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator("[data-message]")).toHaveCount(2);
});

test("permanent deletion still requires confirmation and cancel preserves the message", async ({ page }) => {
	await mailApp(page, [mail({ status: "trash" })]);
	await page.goto("/mail/trash");
	const row = page.locator("[data-message]");
	await row.hover();
	await row.getByRole("button", { name: "Delete permanently", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Delete this message for good?" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(row).toHaveCount(1);
});
