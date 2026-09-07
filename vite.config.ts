import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

/**
 * The commit the Worker reports as its version. Workers Builds sets
 * `WORKERS_CI_COMMIT_SHA` in the build container; a local build reads git.
 */
function buildCommit(): string {
	if (process.env.WORKERS_CI_COMMIT_SHA) return process.env.WORKERS_CI_COMMIT_SHA;
	try {
		return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

/**
 * The deployed Worker's name. Email Routing addresses a Worker by literal name,
 * so provisioning has to know it — and the Deploy to Cloudflare button lets the
 * operator choose it, rewriting `wrangler.jsonc` in their copy. Reading it here
 * keeps the two in step without a second place to edit.
 */
function workerName(): string {
	try {
		const source = readFileSync("wrangler.jsonc", "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		return (JSON.parse(source) as { name?: string }).name ?? "pogmail";
	} catch {
		return "pogmail";
	}
}

export default defineConfig({
	define: {
		__BUILD_COMMIT__: JSON.stringify(buildCommit()),
		__WORKER_NAME__: JSON.stringify(workerName()),
	},
	plugins: [
		tanstackRouter({
			routesDirectory: "src/client/routes",
			generatedRouteTree: "src/client/routeTree.gen.ts",
			target: "react",
			autoCodeSplitting: true,
		}),
		react(),
		tailwindcss(),
		cloudflare(),
	],
	resolve: {
		alias: { "@": new URL("./src", import.meta.url).pathname },
	},
});
