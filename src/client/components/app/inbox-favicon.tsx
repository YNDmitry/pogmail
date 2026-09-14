import { useEffect } from "react";
import { useTheme } from "next-themes";

const ICON_SIZE = 96;

/**
 * Keeps the browser-tab icon in step with the inbox. A canvas data URL lets us
 * retain the branded SVG while drawing a small, legible count over it.
 */
export function InboxFavicon({ unread }: { unread: number }) {
	const { resolvedTheme } = useTheme();

	useEffect(() => {
		const favicon = document.getElementById("theme-favicon") as HTMLLinkElement | null;
		if (!favicon) return;

		const logo = resolvedTheme === "dark" ? "/logo.svg" : "/logo-light.svg";
		if (unread <= 0) {
			favicon.type = "image/svg+xml";
			favicon.href = logo;
			return;
		}

		let cancelled = false;
		const image = new Image();
		image.addEventListener("load", () => {
			if (cancelled) return;

			const canvas = document.createElement("canvas");
			canvas.width = ICON_SIZE;
			canvas.height = ICON_SIZE;
			const context = canvas.getContext("2d");
			if (!context) return;

			context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
			const label = unread > 99 ? "99+" : String(unread);
			const radius = label.length > 2 ? 24 : 19;
			const x = ICON_SIZE - radius - 2;
			const y = radius + 2;

			context.beginPath();
			context.arc(x, y, radius + 3, 0, Math.PI * 2);
			context.fillStyle = resolvedTheme === "dark" ? "#121212" : "#ffffff";
			context.fill();
			context.beginPath();
			context.arc(x, y, radius, 0, Math.PI * 2);
			context.fillStyle = "#df403d";
			context.fill();
			context.fillStyle = "#ffffff";
			context.font = `700 ${label.length > 2 ? 21 : 25}px Geist, sans-serif`;
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillText(label, x, y + 1);

			favicon.type = "image/png";
			favicon.href = canvas.toDataURL("image/png");
		});
		image.src = logo;

		return () => {
			cancelled = true;
		};
	}, [resolvedTheme, unread]);

	return null;
}
