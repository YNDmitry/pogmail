import type { CloudflareClient } from "./client";

/** A sender domain configured in Cloudflare Email Sending for a zone. */
export type EmailSendingSubdomain = {
	enabled: boolean;
	/** Full domain name, for example `example.com` or `mail.example.com`. */
	name: string;
	/** Cloudflare's stable identifier, used to inspect its managed DNS records. */
	tag: string;
};

export function listSendingSubdomains(
	cf: CloudflareClient,
	zoneId: string,
): Promise<EmailSendingSubdomain[]> {
	return cf.get<EmailSendingSubdomain[]>(`/zones/${zoneId}/email/sending/subdomains`);
}

export function createSendingSubdomain(
	cf: CloudflareClient,
	zoneId: string,
	name: string,
): Promise<EmailSendingSubdomain> {
	return cf.post<EmailSendingSubdomain>(`/zones/${zoneId}/email/sending/subdomains`, { name });
}

/**
 * Onboards the exact domain used in `From`, unless it is already configured.
 * Sending is per subdomain, unlike Email Routing which is zone-wide.
 */
export async function ensureSendingSubdomain(
	cf: CloudflareClient,
	zoneId: string,
	hostname: string,
): Promise<EmailSendingSubdomain> {
	const configured = await listSendingSubdomains(cf, zoneId);
	const existing = configured.find((entry) => entry.name.toLowerCase() === hostname.toLowerCase());
	// POST is also Cloudflare's documented way to re-enable a disabled sender.
	return existing?.enabled ? existing : createSendingSubdomain(cf, zoneId, hostname);
}
