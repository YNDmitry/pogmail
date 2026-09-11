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
		if (!document || typeof ResizeObserver === "undefined") return;
		observer.current = new ResizeObserver(fitHeight);
		observer.current.observe(document.body);
		observer.current.observe(document.documentElement);
	}, [fitHeight]);

	useEffect(() => () => observer.current?.disconnect(), []);

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
