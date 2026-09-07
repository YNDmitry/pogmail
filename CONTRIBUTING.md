# Contributing

## Getting set up

```bash
bun install
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run dev
```

Then create the first admin at `http://localhost:5173/setup`.

## Before opening a pull request

```bash
bun run check   # tsc --noEmit for both programs, then oxlint
bun run test    # vitest against a real workerd runtime
```

`bun run build` does not typecheck — Vite strips types without checking them, so
`bun run check` is the gate.

## Things worth knowing

**There are two TypeScript programs, and that is deliberate.** workerd's
`Element` (from HTMLRewriter) merges with the DOM `Element` and silently rewrites
`append`, `setAttribute` and friends. Browser code must never see the Workers
runtime types. Client and Worker share request and response types through
`src/shared/contract/`.

**beUI components are vendored, not forked.** They live under
`src/client/components/motion/` and are excluded from linting. Style them with
`className`; if you change their internals, the next `shadcn add` overwrites you.

**Routing rules have two scopes and they are different engines.** `domain` rules
run while the sender is still connected, in three phases — reject, then real
mailboxes and aliases, then catch-alls. Collapsing those phases lets a `*` rule
swallow mail addressed to a real mailbox. `mailbox` rules run after delivery and
only pick a folder. `test/routing.test.ts` pins this; please keep it passing.

**Migrations have one source of truth**: `drizzle/migrations/`. Run
`bun run db:generate` after changing `src/db/schema/`. `0001_message_search.sql`
is hand-written because drizzle-kit cannot express FTS5 virtual tables.

## Style

Tabs for indentation. `@/*` maps to `src/*`. Comments explain why, not what —
if a line needs a comment to say what it does, the line is the problem.

Anything a machine assigned (an address, hostname, DNS record, Message-ID, key
prefix) is set in mono in the UI. Anything a person wrote is not. Keep it.

## Licence

Contributions are accepted under AGPL-3.0, the licence this project ships under.
