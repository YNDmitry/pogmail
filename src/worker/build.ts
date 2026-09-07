/**
 * The commit this Worker was built from, so an instance can tell whether it is
 * behind upstream. Cloudflare's Workers Builds exposes `WORKERS_CI_COMMIT_SHA`
 * to the build container, and `vite.config.ts` inlines it here; a local build
 * falls back to `git rev-parse`. It is a build-time constant on purpose — a
 * runtime var would have to be reset by hand after every deploy.
 */
declare const __BUILD_COMMIT__: string;

/** Null when the build had no git context at all (a bare tarball, or vitest). */
export const BUILD_COMMIT: string | null =
	// `typeof` survives the define replacement, so an undefined global does not throw.
	typeof __BUILD_COMMIT__ === "string" && __BUILD_COMMIT__ !== "" ? __BUILD_COMMIT__ : null;

/** Where an installation looks for new code. Matches `deploy-update.yml`'s default. */
export const UPSTREAM_REPOSITORY = "YNDmitry/pogmail";
