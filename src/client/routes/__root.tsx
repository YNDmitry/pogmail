import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	component: () => <Outlet />,
	notFoundComponent: NotFound,
});

function NotFound() {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
			<h1 className="display text-2xl">No route to that address</h1>
			<p className="max-w-sm text-sm text-ink-2">
				The page you asked for does not exist here. Check the link, or go back to your inbox.
			</p>
			<a
				href="/mail/inbox"
				className="mt-2 rounded-control bg-primary px-4 py-2 text-sm font-[560] text-primary-foreground"
			>
				Back to inbox
			</a>
		</main>
	);
}
