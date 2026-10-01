import type { MessageDetail, MessageSummary } from "@/shared/contract/mail";

export function conversationKey(mail: Pick<MessageSummary, "mailboxId" | "threadId" | "status" | "id">): string {
	return JSON.stringify([mail.mailboxId, mail.threadId, mail.status === "draft" ? mail.id : null]);
}

/** Sent-mail replies use its recipients rather than blindly using its From address. */
export function replyAddress(mail: Pick<MessageDetail, "direction" | "replyTo" | "fromAddress" | "toAddresses">, ownAddress = mail.fromAddress): string {
	if (mail.direction === "inbound") return mail.replyTo || mail.fromAddress;
	return mail.toAddresses.find((entry) => entry.address.toLowerCase() !== ownAddress.toLowerCase())?.address
		?? mail.toAddresses[0]?.address ?? "";
}

/** Mail lists are scanned, not read: today shows a clock, this year a date. */
export function shortDate(value: string | Date): string {
	const date = typeof value === "string" ? new Date(value) : value;
	const now = new Date();

	const sameDay =
		date.getDate() === now.getDate() &&
		date.getMonth() === now.getMonth() &&
		date.getFullYear() === now.getFullYear();

	if (sameDay) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	if (date.getFullYear() === now.getFullYear()) {
		return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}
	return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fullDate(value: string | Date): string {
	const date = typeof value === "string" ? new Date(value) : value;
	return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function bytes(value: number): string {
	if (value < 1024) return `${value} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let size = value / 1024;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit++;
	}
	return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

/** Falls back to the address when a sender has no display name. */
export function senderLabel(name: string | null, address: string): string {
	return name?.trim() || address;
}

export function initials(value: string): string {
	const cleaned = value.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
	const parts = cleaned.split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
