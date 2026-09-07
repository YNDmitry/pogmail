/**
 * The two directions a composed body has to travel.
 *
 * The editor holds HTML, but every message still carries a `text/plain` part —
 * a mail client that refuses HTML, a screen reader, and the snippet in the
 * folder list all read that one. And a draft written before the editor existed,
 * or a template typed into a plain textarea in Settings, is plain text that has
 * to become a document the editor can open.
 */

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Plain text as HTML: a blank line starts a paragraph, a single newline is a
 * break. That is the convention every mail client uses when it upgrades a
 * plain-text draft, and it keeps a quoted reply looking the way it was typed.
 */
export function textToHtml(text: string | null | undefined): string {
	const value = (text ?? "").replace(/\r\n/g, "\n");
	if (!value.trim()) return "";

	return value
		.split(/\n{2,}/)
		.map((block) => `<p>${escapeHtml(block).split("\n").join("<br>")}</p>`)
		.join("");
}

/** Whether a body carries anything a recipient would see. */
export function htmlHasContent(html: string): boolean {
	return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}
