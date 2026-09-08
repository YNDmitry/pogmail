/// <reference path="./worker-configuration.d.ts" />

/**
 * Secrets are not in wrangler.jsonc, so `wrangler types` cannot know about them.
 * Both the global `Env` and `Cloudflare.Env` are augmented: the Worker uses the
 * former, and `cloudflare:test` hands tests the latter.
 */
interface PogmailSecrets {
	/** Local-only opt-in that provisions reserved `.test` domains without Cloudflare. */
	DEV_MOCK_CLOUDFLARE?: string;
	/**
	 * Cloudflare API token used for domain and mailbox provisioning. It doubles as
	 * the key material the stored GitHub update token is encrypted under.
	 */
	CF_TOKEN: string;
	/**
	 * Overrides the Worker name Email Routing rules point at. Only needed when the
	 * deployed script was renamed away from the name in `wrangler.jsonc`.
	 */
	EMAIL_WORKER_NAME?: string;
}

interface Env extends PogmailSecrets {}

declare namespace Cloudflare {
	interface Env extends PogmailSecrets {}
}
