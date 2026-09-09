import type { CloudflareClient } from "./client";

export type Zone = {
	id: string;
	name: string;
	status: string;
	account?: { id: string; name: string };
};
export type DnsRecord = { id: string; type: string; name: string; content: string; proxied?: boolean };

export function listZones(cf: CloudflareClient): Promise<Zone[]> {
	return cf.get<Zone[]>("/zones?per_page=200");
}

export function getZone(cf: CloudflareClient, zoneId: string): Promise<Zone> {
	return cf.get<Zone>(`/zones/${zoneId}`);
}

export async function findZoneByHostname(cf: CloudflareClient, hostname: string): Promise<Zone | null> {
	// A hostname may be a subdomain of the zone, so walk up: mail.a.example.com,
	// a.example.com, example.com.
	const labels = hostname.split(".");
	for (let i = 0; i < labels.length - 1; i++) {
		const candidate = labels.slice(i).join(".");
		const zones = await cf.get<Zone[]>(`/zones?name=${encodeURIComponent(candidate)}`);
		if (zones[0]) return zones[0];
	}
	return null;
}

export function listDnsRecords(cf: CloudflareClient, zoneId: string): Promise<DnsRecord[]> {
	return cf.get<DnsRecord[]>(`/zones/${zoneId}/dns_records?per_page=500`);
}

export function createDnsRecord(
	cf: CloudflareClient,
	zoneId: string,
	record: { type: string; name: string; content: string; ttl?: number; priority?: number; proxied?: boolean },
): Promise<DnsRecord> {
	return cf.post<DnsRecord>(`/zones/${zoneId}/dns_records`, { ttl: 1, ...record });
}

export function deleteDnsRecord(cf: CloudflareClient, zoneId: string, recordId: string): Promise<unknown> {
	return cf.delete(`/zones/${zoneId}/dns_records/${recordId}`);
}
