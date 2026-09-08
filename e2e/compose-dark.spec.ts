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
});
