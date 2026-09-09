import type { CloudflareClient } from "./client";

export const SUPPRESSION_REASONS = ["manual", "complaint", "hard_bounce", "soft_bounce", "policy"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export type Suppression = {
	id: string;
	created_at: string;
	email: string;
	expires_at: string | null;
	/** Cloudflare, not the reason, decides whether this record may be changed. */
	read_only: boolean;
	reason: SuppressionReason;
	note?: string | null;
};

type SuppressionPageInfo = { count: number; next_cursor: string | null; per_page: number };

export type SuppressionPage = {
	items: Suppression[];
	nextCursor: string | null;
};

export type SuppressionFilters = {
	cursor?: string;
	reason?: SuppressionReason;
	search?: string;
};

/** Lists a bounded page; Cloudflare's opaque cursor carries the active filters. */
export async function listSuppressions(
	cf: CloudflareClient,
	accountId: string,
	filters: SuppressionFilters = {},
): Promise<SuppressionPage> {
	const query = new URLSearchParams({ per_page: "100" });
	if (filters.cursor) query.set("cursor", filters.cursor);
	if (filters.reason) query.set("reason", filters.reason);
	if (filters.search) query.set("search", filters.search);

	const page = await cf.getWithInfo<Suppression[], SuppressionPageInfo>(
		`/accounts/${accountId}/email/sending/suppressions?${query}`,
	);
	return { items: page.result, nextCursor: page.resultInfo?.next_cursor ?? null };
}

export function getSuppression(cf: CloudflareClient, accountId: string, suppressionId: string): Promise<Suppression> {
	return cf.get<Suppression>(`/accounts/${accountId}/email/sending/suppressions/${suppressionId}`);
}

export function deleteSuppression(cf: CloudflareClient, accountId: string, suppressionId: string): Promise<{ id: string }> {
	return cf.delete<{ id: string }>(`/accounts/${accountId}/email/sending/suppressions/${suppressionId}`);
}
