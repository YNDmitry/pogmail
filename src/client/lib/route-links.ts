import type { MouseEvent } from "react";
import type { AnyRouter } from "@tanstack/react-router";

/**
 * beUI's sidebar menu buttons render a real `<a href>` and never call
 * `preventDefault`, so every click was a full document load: the React tree, the
 * query cache, the realtime socket and the resolved instance identity were all
 * torn down and rebuilt on each navigation.
 *
 * Forking the component to swap in a router `Link` would be overwritten by the
 * next install, so plain left-clicks are intercepted in the capture phase and
 * handed to the router instead. The anchor stays a real anchor — middle-click,
 * ⌘-click, shift-click and the browser's own status bar keep working, because
 * those are exactly the cases this hands back.
 */
export function interceptRouterLinks(router: AnyRouter) {
	return (event: MouseEvent<HTMLElement>) => {
		// Anything but a plain primary click belongs to the browser.
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

		const anchor = (event.target as HTMLElement | null)?.closest?.("a");
		if (!anchor) return;

		const href = anchor.getAttribute("href");
		if (!href || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

		// Same-origin, in-app paths only; an absolute URL elsewhere is a real link.
		if (!href.startsWith("/") || href.startsWith("//")) return;

		event.preventDefault();
		const [pathname = "/", search = ""] = href.split("?");
		void router.navigate({
			to: pathname,
			search: search ? Object.fromEntries(new URLSearchParams(search)) : {},
			// Page-level moves cross-fade; nested moves inside a screen do not.
			viewTransition: true,
		});
	};
}
