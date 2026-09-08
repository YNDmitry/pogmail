const MOCK_ZONE_PREFIX = "local:mock:";

/**
 * The local Worker has no Cloudflare account behind it. This opt-in switch lets
 * UI work use reserved `.test` names without ever sending fake domains to the
 * Cloudflare API. Keep it in `.dev.vars`; it is not a production setting.
 */
export function isMockProvisioningEnabled(env: Env): boolean {
	return env.DEV_MOCK_CLOUDFLARE === "true";
}

export function isMockHostname(hostname: string): boolean {
	return hostname.endsWith(".test") && hostname.length > ".test".length;
}

export function mockZoneId(hostname: string): string {
	return `${MOCK_ZONE_PREFIX}${hostname}`;
}

export function isMockZone(zoneId: string): boolean {
	return zoneId.startsWith(MOCK_ZONE_PREFIX);
}
