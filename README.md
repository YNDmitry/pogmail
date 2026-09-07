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
cp .dev.vars.example .dev.vars      # CF_TOKEN
bun run db:migrate:local
bun run dev
```

Open `http://localhost:5173/setup` and create the admin account. Sign-up for
everyone else is off by default — turn it on under Administration → Branding if
you want it.

## Deploying

Click **Deploy to Cloudflare** above. Any Worker name works — the button writes
your choice into `wrangler.jsonc`, and the build reads it back, because Email
Routing binds its rules to the Worker by literal name.
Cloudflare creates and binds D1, R2, Queues, the Durable Object and the backup
Workflow. Enter `CF_TOKEN`, deploy, then open `/setup` on the new Worker URL to
create the first admin.

`CF_TOKEN` is a runtime token, separate from the credential Cloudflare uses for
the deployment. Create a [custom API token](https://dash.cloudflare.com/profile/api-tokens)
with `Zone / Zone / Read`, `Zone / DNS / Edit`, `Zone / Zone Settings / Edit`
and `Zone / Email Routing Rules / Edit`. Limit its Zone Resources to the domains
Pogmail will manage. Paste the token value without the `Bearer` prefix; Pogmail
discovers the account and zones through it.

## Updating

The Deploy button makes a **copy** of this repository in your own account, not a
fork that tracks it, so upstream commits never arrive on their own. Administration
→ Overview compares the commit your Worker was built from against this repository
and offers to run the **Update** workflow in your copy: it merges upstream and
applies pending D1 migrations, and because Workers Builds watches your repository,
the push it makes is what deploys.

The GitHub App behind the Deploy button cannot push `.github/workflows`, so your
copy arrives without the workflow. The first update writes it for you: give the
token `Actions: write`, `Contents: write` and `Workflows: write` on that
repository.

The workflow needs no secrets of its own: it only merges and pushes, Workers
Builds deploys the push, and the Worker applies its own pending D1 migrations —
Administration → Overview lists what a new build carries and applies it on a
button. A first install needs nothing either: `/setup` creates the schema before
the first admin, so a database that arrives empty from the Deploy button works.

Repository and token are asked for once and kept in `update_settings`, so later
updates are a single button. The token is encrypted with AES-GCM under a key
derived from `CF_TOKEN`, the secret this deployment already has, and the API never
returns it. Rotating `CF_TOKEN` therefore makes the stored GitHub token
unreadable — Pogmail says so and asks for it again rather than failing obscurely.

If you cannot sign in — a fresh installation that never got past `/setup`, say —
add `.github/workflows/deploy-update.yml` from here by hand, then run it from
your repository's **Actions** tab.

For a manual deployment:

```bash
bun install
bun x wrangler login
bun x wrangler secret put CF_TOKEN
bun run deploy
```

`bun run deploy` builds and deploys the app, then applies pending D1 migrations.

If you rename the deployed Worker without changing `name` in `wrangler.jsonc`,
adding a domain fails with *Workers Script Info not found*: Email Routing looks
the Worker up by literal name. Fix the config and redeploy, or set the
`EMAIL_WORKER_NAME` variable to the name the script actually has.

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
