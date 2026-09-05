import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Realtime pushes invalidations, so background refetching is mostly noise.
			staleTime: 30_000,
			refetchOnWindowFocus: false,
			retry: (count, error) =>
				error instanceof Error && "status" in error && (error as { status: number }).status === 401
					? false
					: count < 2,
		},
	},
});

const router = createRouter({
	routeTree,
	context: { queryClient },
	// Hovering a destination warms its route before the click lands.
	defaultPreload: "intent",
	defaultPreloadDelay: 60,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
	<StrictMode>
		{/*
		 * A class, not an attribute: the palette in styles.css is written against
		 * `.dark`, and next-themes sets that class both for an explicit choice and
		 * for the resolved system preference.
		 */}
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</ThemeProvider>
	</StrictMode>,
);
