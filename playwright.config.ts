import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
		actionTimeout: 10_000,
		navigationTimeout: 30_000,
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "mobile", use: { ...devices["Pixel 5"] } },
	],
});
