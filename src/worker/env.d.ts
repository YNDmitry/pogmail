/// <reference path="./worker-configuration.d.ts" />

/**
 * Secrets are not in wrangler.jsonc, so `wrangler types` cannot know about them.
 * Both the global `Env` and `Cloudflare.Env` are augmented: the Worker uses the
 * former, and `cloudflare:test` hands tests the latter.
 */
interface PogmailSecrets {
	/** Cloudflare API token used for domain and mailbox provisioning. */
	CF_TOKEN: string;
	CF_ACCOUNT_ID: string;
	/** Base64 key reserved for signed tokens; sessions themselves are database-backed. */
	SESSION_SECRET: string;
}

interface Env extends PogmailSecrets {}

declare namespace Cloudflare {
	interface Env extends PogmailSecrets {}
}
