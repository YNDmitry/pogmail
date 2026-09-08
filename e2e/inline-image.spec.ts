import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("Inline image draft", () => {
	test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD for an existing local test account.");

	test.beforeEach(async ({ page }) => {
		await page.goto("/login");
		await page.getByLabel("Email").fill(email!);
		await page.getByLabel("Password").fill(password!);
		await page.getByRole("button", { name: "Sign in" }).click();
		await page.goto("/compose");
	});

	test("keeps an uploaded image private, visible, and CID-backed after reopening", async ({ page }) => {
		const subject = `CID preview ${Date.now()}`;
		await page.getByLabel("To").fill("recipient@example.test");
		await page.getByLabel("Subject").fill(subject);

		const editor = page.locator(".maily-compose-editor .ProseMirror");
		await editor.click();
		await page.keyboard.type("/image");
		await page.locator('[data-tippy-root]').getByText("Image", { exact: true }).click();

		const uploadResponse = page.waitForResponse((response) =>
			response.request().method() === "POST" && /\/api\/send\/drafts\/[^/]+\/attachments$/.test(response.url()),
		);
		await page.locator(".mly-image-drop-zone input[type=file]").setInputFiles({
			name: "cid-check.png",
			mimeType: "image/png",
			buffer: Buffer.from([137, 80, 78, 71]),
		});
		const uploaded = await uploadResponse;
		expect(uploaded.ok()).toBeTruthy();
		const draftId = uploaded.url().match(/\/drafts\/([^/]+)\/attachments$/)?.[1];
		expect(draftId).toBeTruthy();

		const preview = page.locator(`img[src^="/api/send/drafts/${draftId}/attachments/"]`);
		await expect(preview).toBeVisible();

		await page.getByRole("button", { name: "Save and close" }).click();
		await expect(page).toHaveURL(/\/mail\/drafts/);
		await page.goto(`/compose?draftId=${draftId}`);
		await expect(page.locator(`img[src^="/api/send/drafts/${draftId}/attachments/"]`)).toBeVisible();

		const savedHtml = await page.evaluate(async (id) => {
			const response = await fetch(`/api/messages/${id}`);
			return (await response.json() as { bodyHtml: string | null }).bodyHtml;
		}, draftId!);
		expect(savedHtml).toMatch(/cid:[a-f0-9-]+/);
		expect(savedHtml).not.toContain("/api/send/drafts/");
	});
});
