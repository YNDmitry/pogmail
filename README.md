# Pogmail

Self-hosted email for domains you already own, running entirely on Cloudflare.
Receive, route, read, search and send mail; manage domains, mailboxes, sharing,
filters and webhooks — from one Worker and one `wrangler deploy`.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YNDmitry/pogmail)

AGPL-3.0. Every feature is in the box: there is no paid tier, and nothing is
gated behind a licence key.

## What it does

- **Receiving** — Cloudflare Email Routing delivers to the Worker, which resolves
  the recipient, stores the untouched MIME in R2, and parses it on a queue.
- **Routing** — rules at two scopes: domain rules accept, reject or forward while
  the sender is still connected; mailbox rules file accepted mail into folders.
- **Sending** — compose, drafts, scheduled sends, signatures, templates, and
  out-of-office replies with real loop guards.
- **Sharing** — mailboxes can be shared with read, send-as, send-on-behalf or full
  access, independent of who owns them.
- **Search** — full-text over subject, body and sender, via SQLite FTS5 in D1.
- **Webhooks** — HMAC-signed POSTs on delivery, with retry history and a test
  button; endpoints that keep failing are switched off automatically.
- **Operations** — audit log, scheduled database backups to R2, import and export
  as NDJSON or mbox, a public `/api/v1` for API-key clients, and self-update via
  a GitHub Actions workflow.

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TanStack Router and Query, Tailwind v4, beUI components |
| Bundling | Vite with `@cloudflare/vite-plugin` — SPA and Worker in one artifact |
| API | Hono on Workers |
| Data | D1 with Drizzle ORM, 22 tables |
| Blobs | R2 — raw MIME, attachments, avatars, backups |
| Async | Queues for inbound parsing, outbound sends and webhook retries |
| Realtime | A Durable Object per user, WebSocket fan-out |
| Scheduled | Cron for snooze wake-ups and scheduled backups |
| Tests | Vitest on a real workerd runtime with real bindings |

## Getting started

```bash
bun install
cp .dev.vars.example .dev.vars      # CF_TOKEN, CF_ACCOUNT_ID, SESSION_SECRET
bun run db:migrate:local
bun run dev
```

Open `http://localhost:5173/setup` and create the admin account. Sign-up for
everyone else is off by default — turn it on under Administration → Branding if
you want it.

## Deploying

Click **Deploy to Cloudflare** above and keep the Worker name as `pogmail`.
Cloudflare creates and binds D1, R2, Queues, the Durable Object and the backup
Workflow. Enter the three requested secrets, deploy, then open `/setup` on the
new Worker URL to create the first admin.

`CF_TOKEN` is a runtime token, separate from the credential Cloudflare uses for
the deployment. Give it `Zone:Read`, `DNS:Edit`, `Email Routing:Edit`,
`Email Sending:Edit` and `Email Routing Rules:Edit` for the domains Pogmail will
host. `CF_ACCOUNT_ID` is the account that owns those domains. Generate
`SESSION_SECRET` with `openssl rand -base64 32`.

For a manual deployment:

```bash
bun install
bun x wrangler login
bun x wrangler secret put CF_TOKEN
bun x wrangler secret put CF_ACCOUNT_ID
bun x wrangler secret put SESSION_SECRET
bun run deploy
```

`bun run deploy` builds and deploys the app, then applies pending D1 migrations. The Worker name and `CF_EMAIL_WORKER_NAME` in `wrangler.jsonc` must
match because Email Routing addresses the Worker by literal name.

## Commands

```bash
bun run dev            # vite dev, real bindings via miniflare
bun run check          # typecheck both programs, then lint
bun run test           # vitest under workerd
bun run build          # SPA + Worker into dist/
bun run deploy         # build, deploy, then migrate D1

bun run db:generate    # drizzle-kit generate
bun run db:migrate:local
bun run db:migrate:remote
bun run cf-typegen     # regenerate worker-configuration.d.ts
```

## API

Cookie sessions serve the dashboard. Scripts use a bearer API key against the
versioned surface:

```bash
curl https://mail.example.com/api/v1/messages \
  -H "Authorization: Bearer pbk_..."
```

Keys carry explicit scopes (`messages:read`, `messages:send`, …) and are stored
only as a SHA-256 hash. Create them under Settings → API keys.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `bun run check && bun run test`
before opening a pull request, and keep `test/routing.test.ts` green — it pins
the phase order that stops a catch-all rule from swallowing real mail.
