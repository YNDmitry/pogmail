/** One place for cache keys, so an invalidation cannot miss a list by a typo. */
export const qk = {
	session: ["session"] as const,
	branding: ["branding"] as const,
	setupStatus: ["setup", "status"] as const,

	mailboxes: ["mailboxes"] as const,
	mailbox: (id: string) => ["mailboxes", id] as const,

	messages: (filters: Record<string, unknown>) => ["messages", filters] as const,
	message: (id: string) => ["messages", id] as const,
	thread: (id: string) => ["messages", id, "thread"] as const,
	counts: ["messages", "counts"] as const,

	folders: ["folders"] as const,
	contacts: (filters: Record<string, unknown> = {}) => ["contacts", filters] as const,
	templates: ["templates"] as const,
	calendar: (from: number, to: number) => ["calendar", from, to] as const,

	domains: ["domains"] as const,
	domain: (id: string) => ["domains", id] as const,
	domainDns: (id: string) => ["domains", id, "dns"] as const,

	rules: (filters: Record<string, unknown> = {}) => ["routing-rules", filters] as const,
	webhooks: ["webhooks"] as const,
	deliveries: (id: string) => ["webhooks", id, "deliveries"] as const,

	apiKeys: ["api-keys"] as const,
	accounts: ["accounts"] as const,
	account: (id: string) => ["accounts", id] as const,
	activity: ["activity"] as const,
	backups: ["backups"] as const,
	adminOverview: ["admin", "overview"] as const,
	adminVersion: ["admin", "version"] as const,
	adminUpdateConfig: ["admin", "update", "config"] as const,
	adminMigrations: ["admin", "migrations"] as const,
};
