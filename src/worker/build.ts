/**
 * The commit this Worker was built from, so an instance can tell whether it is
 * behind upstream. Cloudflare's Workers Builds exposes `WORKERS_CI_COMMIT_SHA`
 * to the build container, and `vite.config.ts` inlines it here; a local build
 * falls back to `git rev-parse`. It is a build-time constant on purpose — a
 * runtime var would have to be reset by hand after every deploy.
 */
declare const __BUILD_COMMIT__: string;
declare const __WORKER_NAME__: string;

/** Null when the build had no git context at all (a bare tarball, or vitest). */
export const BUILD_COMMIT: string | null =
	// `typeof` survives the define replacement, so an undefined global does not throw.
	typeof __BUILD_COMMIT__ === "string" && __BUILD_COMMIT__ !== "" ? __BUILD_COMMIT__ : null;

/**
 * The Worker's own name, read from `wrangler.jsonc` at build time. Email Routing
 * addresses a Worker by literal name, so a deployment renamed at the Deploy button
 * — `pogmail-new`, say — must provision against that name, not a hardcoded one.
 */
export const WORKER_NAME: string =
	typeof __WORKER_NAME__ === "string" && __WORKER_NAME__ !== "" ? __WORKER_NAME__ : "pogmail";

/** Where an installation looks for new code. Matches `deploy-update.yml`'s default. */
export const UPSTREAM_REPOSITORY = "YNDmitry/pogmail";
