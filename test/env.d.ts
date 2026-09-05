/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference path="../src/worker/env.d.ts" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare module "vitest" {
	interface ProvidedContext {
		migrations: D1Migration[];
	}
}
