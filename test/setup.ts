import { applyD1Migrations, env } from "cloudflare:test";
import { inject } from "vitest";

// Each test worker gets its own D1 instance, so migrations run once per worker.
await applyD1Migrations(env.DB, inject("migrations"));
