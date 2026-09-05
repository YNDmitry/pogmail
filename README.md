# Pogmail

Self-hosted email for domains you already own, running entirely on Cloudflare.
Receive, route, read, search and send mail; manage domains, mailboxes, sharing,
filters and webhooks — from one Worker and one `wrangler deploy`.

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
npm install
cp .dev.vars.example .dev.vars      # CF_TOKEN, CF_ACCOUNT_ID, SESSION_SECRET

npx wrangler d1 create postbox      # paste database_id into wrangler.jsonc
npm run db:migrate:local
npm run dev
```

Open `http://localhost:5173/setup` and create the admin account. Sign-up for
everyone else is off by default — turn it on under Administration → Branding if
you want it.

## Deploying

```bash
npx wrangler d1 create postbox      # database_id → wrangler.jsonc
npx wrangler r2 bucket create postbox-mail
npx wrangler queues create postbox-inbound
npx wrangler queues create postbox-outbound
npx wrangler queues create postbox-dlq

npx wrangler secret put CF_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put SESSION_SECRET

npm run db:migrate:remote
npm run deploy
```

The Worker `name` in `wrangler.jsonc` and the `CF_EMAIL_WORKER_NAME` var must
match: Cloudflare Email Routing addresses the Worker by literal name.

`CF_TOKEN` needs `Zone:Read`, `DNS:Edit` and `Email Routing:Edit` on the zones
you plan to host mail for. Pogmail turns Email Routing on, adds the MX and TXT
records Cloudflare asks for, and points the catch-all at the Worker.

## Commands

```bash
npm run dev            # vite dev, real bindings via miniflare
npm run check          # typecheck both programs, then lint
npm test               # vitest under workerd
npm run build          # SPA + Worker into dist/
npm run deploy         # build, then wrangler deploy

npm run db:generate    # drizzle-kit generate
npm run db:migrate:local
npm run db:migrate:remote
npm run cf-typegen     # regenerate worker-configuration.d.ts
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

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm run check && npm test`
before opening a pull request, and keep `test/routing.test.ts` green — it pins
the phase order that stops a catch-all rule from swallowing real mail.
