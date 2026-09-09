const MAX_SNIPPET_LENGTH = 200;

/**
 * Produces a compact, human-readable preview from an email's MIME alternatives.
 * Some senders generate a text alternative made almost entirely of ASCII table
 * borders; those must not become the first thing visible in the inbox.
 */
export function messageSnippet(text?: string | null, html?: string | null): string {
	const plainText = cleanText(text ?? "");
	const htmlText = cleanText(htmlToText(html ?? ""));
	const best = plainText || htmlText;

	return best.slice(0, MAX_SNIPPET_LENGTH);
}

/** True when a stored preview is only a MIME/table decoration and can be rebuilt. */
export function needsSnippetRepair(snippet?: string | null): boolean {
	if (!snippet?.trim()) return true;

	return !/[\p{L}\p{N}]/u.test(
		snippet.replace(/[+|\-=_:.*\s┌┐└┘├┤┬┴┼─━│┃╔╗╚╝╠╣╦╩╬═║]/gu, ""),
	);
}

function cleanText(value: string): string {
	return value
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) =>
			line
				// Borders generated for plain-text representations of HTML tables.
				.replace(/\+[-=]{3,}\+/g, " ")
				.replace(/[┌┐└┘├┤┬┴┼─━│┃╔╗╚╝╠╣╦╩╬═║]/gu, " ")
				.replace(/(^|\s)\|(?=\s|$)/g, " ")
				.replace(/[-=]{4,}/g, " ")
				.replace(/[\t ]+/g, " ")
				.trim(),
		)
		.filter((line) => line && !/^[+|\-=_:.\s]+$/.test(line))
		.join(" ")
		.replace(/\s+/g, " ")
		.replace(/\s+([,.;:!?])/g, "$1")
		.trim();
}

function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, " ")
			.replace(/<\/?(?:br|p|div|tr|li|h[1-6])\b[^>]*>/gi, "\n")
			.replace(/<[^>]+>/g, " "),
	);
}

function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#(x[\da-f]+|\d+);/gi, (_, entity: string) => {
			const codePoint = Number.parseInt(entity, entity.startsWith("x") || entity.startsWith("X") ? 16 : 10);
			return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
				? String.fromCodePoint(codePoint)
				: " ";
		});
}
