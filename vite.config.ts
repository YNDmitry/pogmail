import { execSync } from "node:child_process";
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

export default defineConfig({
	define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
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
