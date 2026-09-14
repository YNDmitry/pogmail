/** Returns the display/send address for either a Cloudflare or external mailbox. */
export function mailboxAddress(row: {
	externalAddress: string | null;
	localPart: string;
	hostname: string | null;
}): string {
	if (row.externalAddress) return row.externalAddress;
	if (!row.hostname) throw new Error("Cloudflare mailbox is missing its domain");
	return `${row.localPart}@${row.hostname}`;
}
