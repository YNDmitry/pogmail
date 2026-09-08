/**
 * Email HTML is allowed to be expressive, but it never needs active browser
 * features. This small boundary deliberately removes those before a message is
 * delivered. Inbound email is separately isolated in a sandboxed iframe.
 */
export function safeEmailHtml(value: string | null | undefined): string | null {
	if (!value) return null;

	return value
		.replace(/<!--[^]*?-->/g, "")
		.replace(/<(script|iframe|object|embed|base|meta|link|form)\b[^>]*>[^]*?<\/\1\s*>/gi, "")
		.replace(/<(script|iframe|object|embed|base|meta|link|form)\b[^>]*\/?\s*>/gi, "")
		.replace(/\s(?:on[a-z]+|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/\s(?:href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi, "")
		.replace(/expression\s*\(|url\s*\(\s*["']?\s*javascript:/gi, "");
}
