import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("Mobile message reader", () => {
	test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD for an existing local test account.");

	test("opens a message and returns to the list", async ({ page, isMobile }) => {
		test.skip(!isMobile, "Mobile layout only.");

		await page.goto("/login");
		await page.getByLabel("Email").fill(email!);
		await page.getByLabel("Password").fill(password!);
		await page.getByRole("button", { name: "Sign in" }).click();
		await page.goto("/mail/inbox");

		const message = page.locator("[data-message] a").first();
		test.skip((await message.count()) === 0, "The test account has no inbox messages.");
		await message.click();

		await expect(page.locator("article")).toBeVisible();
		await page.getByRole("link", { name: "Back to messages" }).click();
		await expect(message).toBeVisible();
	});
});
