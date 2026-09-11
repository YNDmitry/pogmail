import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("Compose in dark theme", () => {
	test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD for an existing local test account.");

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem("theme", "dark"));
		await page.goto("/login");
		await page.getByLabel("Email").fill(email!);
		await page.getByLabel("Password").fill(password!);
		await page.getByRole("button", { name: "Sign in" }).click();
		await page.goto("/compose");
	});

	test("keeps the editor and slash-command card in the dark palette", async ({ page }) => {
		await expect(page.locator("html")).toHaveClass(/dark/);
		const editor = page.locator(".maily-compose-editor .ProseMirror");
		await expect(editor).toBeVisible();
		await editor.click();
		await page.keyboard.type("/");
		await expect(page.locator('[data-tippy-root]:has([class*="mly:shadow-md"])')).toBeVisible();
	});

	test("keeps formatting in the selection menu instead of a persistent toolbar", async ({ page }) => {
		const editor = page.locator(".maily-compose-editor .ProseMirror");
		await editor.fill("Format this text");
		await editor.selectText();
		await expect(page.locator(".maily-compose-toolbar")).toHaveCount(0);
		await expect(page.locator(".maily-compose-editor [data-tippy-root]")).toBeVisible();
	});

	test("previews the current message at desktop and mobile widths", async ({ page }) => {
		await page.getByLabel("Subject").fill("Preview subject");
		await page.locator(".maily-compose-editor .ProseMirror").fill("Preview body");
		await page.getByRole("button", { name: "Preview" }).click();

		const preview = page.getByRole("dialog", { name: "Message preview" });
		await expect(preview).toBeVisible();
		await expect(preview.getByText("Preview subject")).toBeVisible();
		await expect(preview.locator('iframe[title="Message body preview"]').contentFrame().locator("body")).toContainText("Preview body");
		await expect(preview.locator("[data-preview-width]")).toHaveAttribute("data-preview-width", "desktop");

		await preview.getByRole("button", { name: "Mobile" }).click();
		await expect(preview.locator("[data-preview-width]")).toHaveAttribute("data-preview-width", "mobile");
	});

	test("previews an unsaved template without losing its edits", async ({ page }) => {
		await page.goto("/settings/templates");
		await page.getByRole("button", { name: "New template" }).click();

		const editor = page.getByRole("dialog", { name: "New template" });
		await editor.getByLabel("Name").fill("Previewable template");
		await editor.getByLabel("Subject").fill("Template subject");
		await editor.locator(".ProseMirror").fill("Template body");
		await editor.getByRole("button", { name: "Preview" }).click();

		await expect(page.getByText("Template subject")).toBeVisible();
		await expect(page.locator('iframe[title="Template body preview"]').contentFrame().locator("body")).toContainText("Template body");
		await page.getByRole("button", { name: "Back to editor" }).click();
		await expect(editor.getByLabel("Name")).toHaveValue("Previewable template");
	});
});
