/**
 * Bounded exponential backoff for queue failures. The first retry remains quick,
 * while later retries stop hammering an unavailable dependency.
 */
export function queueRetryDelay(attempts: number): number {
	return Math.min(60 * 60, 10 * 2 ** Math.max(0, attempts - 1));
}
