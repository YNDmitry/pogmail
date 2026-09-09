/** Cloudflare Queues accepts a per-message delay of no more than 24 hours. */
export const MAX_QUEUE_DELAY_SECONDS = 24 * 60 * 60;

/**
 * Returns the next bounded queue delay, or `undefined` once the message is due.
 * Re-enqueuing at this interval makes arbitrarily distant scheduled sends safe
 * without a polling worker or an upper limit imposed by the queue API.
 */
export function nextScheduledDelay(scheduledFor: Date | null, now = Date.now()): number | undefined {
	if (!scheduledFor) return undefined;
	const remainingMs = scheduledFor.getTime() - now;
	if (remainingMs <= 0) return undefined;
	return Math.min(MAX_QUEUE_DELAY_SECONDS, Math.ceil(remainingMs / 1000));
}
