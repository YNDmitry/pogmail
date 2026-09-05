/**
 * Every Pogmail is somebody's own server, so every Pogmail wears its own face.
 *
 * The instance identity is generated, not authored: a deterministic hash of what
 * makes this deployment itself — the name its admin gave it and the host it
 * answers on — is expanded into parameters, and those parameters draw the mark.
 * Two installations carry a recognisably different figure; the same installation
 * draws the same one on every device, forever, with nothing stored.
 *
 * Colour is not one of those parameters. The palette — coral brand, and the
 * fixed delivered/queued/failed signals — is the same in every deployment, so an
 * operator moving between two Pogmail instances never has to relearn what a colour
 * means. The seed reaches the mark's geometry and nothing else.
 */

export type Identity = {
	/** Shown to the operator; the instance's fingerprint, not a secret. */
	seed: string;
	/** How many strokes the mark and the field carry, 0–1. */
	density: number;
	/** How far each stroke bends away from the last, 0–1. */
	curve: number;
	/** How far each stroke turns from the last, 0–1. */
	rhythm: number;
};

/** FNV-1a, 32-bit. Small, dependency-free, and stable across engines. */
function hash(input: string): number {
	let value = 0x811c9dc5;
	for (let index = 0; index < input.length; index++) {
		value ^= input.charCodeAt(index);
		value = Math.imul(value, 0x01000193) >>> 0;
	}
	return value >>> 0;
}

/**
 * Three bytes, three parameters. Each field is derived from its own byte so a
 * one-character change in the source moves the whole mark, not one axis.
 */
export function deriveIdentity(source: string): Identity {
	const value = hash(source);
	const [b, c, d] = [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];

	return {
		seed: value.toString(16).padStart(8, "0").toUpperCase(),
		density: b / 255,
		curve: c / 255,
		rhythm: d / 255,
	};
}

/**
 * Publishes the identity to CSS. Colour is not part of it: the palette is fixed
 * coral in every deployment, so what the seed still owns is the geometry of the
 * mark and the instance fingerprint an operator can read off the overview.
 */
export function applyIdentity(identity: Identity): void {
	const root = document.documentElement;
	root.style.setProperty("--id-density", identity.density.toFixed(3));
	root.style.setProperty("--id-curve", identity.curve.toFixed(3));
	root.style.setProperty("--id-rhythm", identity.rhythm.toFixed(3));
	root.dataset.seed = identity.seed;
}

/**
 * What the instance is, spelled the same way every time. The host is part of it
 * because one admin running two deployments of the same name should still be
 * able to tell which window is which.
 */
export function identitySource(appName: string): string {
	const host = typeof location === "undefined" ? "localhost" : location.host;
	return `${appName.trim().toLowerCase()}@${host.toLowerCase()}`;
}
