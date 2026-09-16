import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/client/lib/utils";

const MIN_HEIGHT = 384;

/**
 * An email's document has no predictable height: receipts and newsletters often
 * grow after their images load. This frame observes that document and becomes
 * exactly as tall as its content, so the page has one natural scrollbar instead
 * of a short, easily missed nested one.
 *
 * Scripts remain disabled. `allow-same-origin` only lets this component read the
 * rendered height after load; it does not permit scripts, forms, popups, or top
 * navigation from the email.
 */
export function EmailFrame({
	title,
	html,
	className,
}: {
	title: string;
	html: string;
	className?: string;
}) {
	const frame = useRef<HTMLIFrameElement>(null);
	const observer = useRef<ResizeObserver | null>(null);

	const fitHeight = useCallback(() => {
		const element = frame.current;
		const document = element?.contentDocument;
		if (!document) return;
		const height = Math.max(
			MIN_HEIGHT,
			document.body.scrollHeight,
			document.documentElement.scrollHeight,
		);
		element.style.height = `${height}px`;
	}, []);

	const observeHeight = useCallback(() => {
		observer.current?.disconnect();
		fitHeight();

		const document = frame.current?.contentDocument;
		if (!document) return;

		// The frame is deliberately tall enough for the whole message, so it must
		// never become a second vertical scroll container. Wheel gestures over an
		// iframe belong to its browsing-context boundary, even when it only overflows
		// by a pixel; the parent-level relay below sends them to the reader viewport.
		document.documentElement.style.setProperty("overflow", "hidden", "important");
		document.body.style.setProperty("overflow", "hidden", "important");

		if (typeof ResizeObserver === "undefined") return;
		observer.current = new ResizeObserver(fitHeight);
		observer.current.observe(document.body);
		observer.current.observe(document.documentElement);
	}, [fitHeight]);

	useEffect(() => {
		const relayScroll = (event: WheelEvent) => {
			const element = frame.current;
			if (!element || event.ctrlKey) return;
			const bounds = element.getBoundingClientRect();
			const pointerIsOverFrame =
				event.clientX >= bounds.left &&
				event.clientX <= bounds.right &&
				event.clientY >= bounds.top &&
				event.clientY <= bounds.bottom;
			if (!pointerIsOverFrame) return;
			const scrollViewport = element.ownerDocument.querySelector<HTMLElement>(
				".app-scroll-viewport",
			);
			if (!scrollViewport) return;
			const unit =
				event.deltaMode === WheelEvent.DOM_DELTA_LINE
					? 16
					: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
							? scrollViewport.clientHeight
							: 1;
			event.preventDefault();
			scrollViewport.scrollTop += event.deltaY * unit;
			scrollViewport.scrollLeft += event.deltaX * unit;
		};

		window.addEventListener("wheel", relayScroll, {
			capture: true,
			passive: false,
		});
		return () => {
			observer.current?.disconnect();
			window.removeEventListener("wheel", relayScroll, true);
		};
	}, []);

	return (
		<iframe
			ref={frame}
			title={title}
			sandbox="allow-same-origin"
			referrerPolicy="no-referrer"
			onLoad={observeHeight}
			className={cn("block min-h-96 w-full bg-white", className)}
			srcDoc={html}
		/>
	);
}
