import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
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
