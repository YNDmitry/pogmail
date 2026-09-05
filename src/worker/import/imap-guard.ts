/**
 * The host comes from a form, and the Worker will happily open a socket to
 * anything — including addresses only reachable from inside a network. These
 * checks keep an import from being turned into a port scanner.
 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

export function assertSafeImapHost(hostname: string): void {
	const host = hostname.trim().toLowerCase();

	if (!host || host.length > 253) throw new Error("That does not look like a hostname");
	if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
		throw new Error("That host is not reachable from here");
	}

	if (isBlockedIpv4(host) || isBlockedIpv6(host)) {
		throw new Error("Private and loopback addresses are not allowed");
	}
}

function isBlockedIpv4(host: string): boolean {
	const parts = host.split(".");
	if (parts.length !== 4) return false;

	const octets = parts.map(Number);
	if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;

	const [a, b] = octets as [number, number, number, number];
	return (
		a === 0 || // this network
		a === 10 || // private
		a === 127 || // loopback
		(a === 169 && b === 254) || // link-local, including cloud metadata
		(a === 172 && b >= 16 && b <= 31) || // private
		(a === 192 && b === 168) || // private
		(a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
		a >= 224 // multicast and reserved
	);
}

function isBlockedIpv6(host: string): boolean {
	const address = host.replace(/^\[|\]$/g, "");
	if (!address.includes(":")) return false;

	const normalized = address.toLowerCase();
	return (
		normalized === "::1" || // loopback
		normalized === "::" || // unspecified
		normalized.startsWith("fc") || // unique local
		normalized.startsWith("fd") ||
		normalized.startsWith("fe80") || // link-local
		normalized.startsWith("::ffff:") // IPv4-mapped, which would bypass the v4 checks
	);
}
