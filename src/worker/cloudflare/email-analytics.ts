import type { CloudflareClient } from "./client";

export type SendingMetric = {
	date: string;
	status: string;
	total: number;
};

type AnalyticsResponse = {
	viewer: {
		zones: Array<{
			emailSendingAdaptiveGroups: Array<{
				count: number;
				dimensions: { date: string; status: string | null };
			}>;
		}>;
	};
};

const SENDING_METRICS_QUERY = `
	query EmailSendingMetrics($zoneTag: string!, $start: Date!, $end: Date!) {
		viewer {
			zones(filter: { zoneTag: $zoneTag }) {
				emailSendingAdaptiveGroups(
					filter: { date_geq: $start, date_leq: $end }
					limit: 10000
					orderBy: [date_DESC]
				) {
					count
					dimensions { date status }
				}
			}
		}
	}
`;

/** Aggregated Cloudflare delivery events; no recipient or message content leaves the account. */
export async function getSendingMetrics(
	cf: CloudflareClient,
	zoneTag: string,
	start: string,
	end: string,
): Promise<SendingMetric[]> {
	const data = await cf.graphql<AnalyticsResponse>(SENDING_METRICS_QUERY, { zoneTag, start, end });
	return data.viewer.zones.flatMap((zone) =>
		zone.emailSendingAdaptiveGroups.map((entry) => ({
			date: entry.dimensions.date,
			status: entry.dimensions.status ?? "unknown",
			total: entry.count,
		})),
	);
}
