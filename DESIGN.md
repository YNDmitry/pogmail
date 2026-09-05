# Design

Recorded from the built world, not from intention. If the code and this file
disagree, the code is right and this file is stale.

## Where the system comes from

The visual system is Pogpin's, adopted whole: `src/client/styles.css` is that
project's `globals.css` — brand ramp, shell surfaces, auth palette, motion
tokens and the `.pogpin-*` utilities — with the tiptap/public-document sections
trimmed and a Pogmail bridge appended at the end. Keep the two in sync by
copying from Pogpin, not by editing the tokens here.

Pogmail's own markup speaks an older vocabulary (`ground`, `panel`, `recess`,
`seam`, `ink`, `ok`/`wait`/`fail`). Those names survive as **aliases** in the
bridge's `@theme inline` block, each pointing at the Pogpin token that holds the
same role, so there is one definition per role and no second theme block.

| Alias                  | Resolves to                     |
| ---------------------- | ------------------------------- |
| `ground`               | `--background`                  |
| `panel` / `recess`     | `--pogpin-shell-panel` / `-alt` |
| `seam` / `seam-strong` | `--pogpin-shell-border(-strong)` |
| `ink` / `-2` / `-3`    | `--pogpin-shell-text(-soft/-muted)` |
| `ok` / `wait` / `fail` | `--pogpin-success` / `-warning` / `-danger` |
| `shadow-lift`          | `--pogpin-shell-shadow-strong`  |

New markup should prefer the Pogpin and shadcn names directly.

## Colour

**Coral is the brand and never doubles as an error.** `--pogpin-brand-500`
(`#ff5e57`) is the primary CTA, the active route, selection and focus — one
coral action per view, everything else on the neutral surface. Text on a coral
fill is `--primary-foreground`, never `text-white`.

Delivery states keep their own fixed statuses — `--pogpin-success` delivered,
`--pogpin-warning` queued, `--pogpin-danger` failed — identical in light and
dark, so an operator moving between deployments never relearns a colour. Nothing
depends on hue alone: every tone in `Tag` carries a glyph.

## The seed and the mark

`src/client/lib/identity.ts` still hashes `"<appname>@<host>"` (FNV-1a) into
`density`, `curve` and `rhythm`, and `components/app/mark.tsx` draws the mark
from them: open arcs sweeping one centre, geometry rather than illustration, the
same figure at 18px in the sidebar and at sign-in scale.

**The seed no longer reaches colour.** The mark walks the coral ramp from
`--pogpin-brand-300` to `--pogpin-brand-700`; every instance is coral, and what
differs between two deployments is the figure, not the palette. The eight-hex
seed is a fingerprint, shown on the admin overview.

## The shell

`routes/_app.tsx`. The sidebar sits on the page ground and the content is a
panel floating on it — `gap-3 p-3` between them, the panel `rounded-xl` with a
hairline border, both dropped flush on small screens. Navigation is beUI's
animated sidebar at `13rem`, collapsing to a `4.25rem` icon rail; the choice
persists in `localStorage` and is read during the first render, because a panel
that animates its width cannot correct itself in an effect without flashing.

`HeaderBar` carries where you are, the two ways back to navigation (rail toggle
on desktop, sheet trigger below `xl`), search, and Write — the one coral action.
`AccountCard` anchors the footer; collapsed, only the avatar survives the clip,
so settings, theme and sign-out live one click deeper rather than falling off
the rail.

Signed out is a different surface: `routes/_auth.tsx` is dark in both themes —
one ground, one `.pogpin-auth-card`, the mark above the form. Auth fields use
`.pogpin-auth-input` and the auth palette, never the app's theme-following
tokens, which would vanish against the card.

## The mailbox filter

An address is not a destination, it is a filter over the folders already in the
sidebar, so it is a switcher in the sidebar header rather than a second list of
places to go. It lives in the URL (`?mailboxId=`), which is what makes the view
shareable and lets the sidebar read the current value back instead of keeping a
copy. Picking one keeps the folder being read and drops the open message; the
folder links carry the filter with them, and the list header shows it as a chip
that can clear it — the sidebar is a sheet on small screens, so it cannot be the
only place the filter is visible.

## Surfaces

- `--radius-control` 6px for buttons and inputs, `--radius-card` 8px for cards,
  `--radius-dialog` 12px for dialogs and menus. Pills are for badges and tags.
- Cards are `border + bg-card + shadow-sm`. Floating layers — modals, popovers,
  toasts, the command palette — carry the heavier shadow instead.
- `.pogpin-shell-*` utilities are the shell's own surfaces (`-panel-alt`,
  `-chip`, `-field`, `-tabs`, `-tab-trigger`, `-stat-card`); use them rather
  than re-deriving the same border/background pair inline.

## Calendar

Three views, in the URL (`?view=&month=&day=`): month, week and agenda. The week
is the one with hours — 48px an hour, quarter-hour snapping, overlapping events
splitting the column, a line at now. Gestures there are the ones every calendar
has trained: drag an empty stretch to open an event over it, drag a block to move
it (including to another day), drag its bottom edge to change when it ends. In
the month grid a chip drags to another day and keeps its time, because a month
cell has no hours to read a new one from.

Keys: `←`/`→` step by whatever is on screen, `T` today, `N` new event,
`M`/`W`/`A` switch view. They stand down while a dialog is open or a field has
focus.

## Two ways to read mail

The operator chooses, in Settings → Profile: **Conversations** collapses a thread
to one row and stacks its messages when opened, **Individual messages** keeps one
row per message. The choice lives on the account, not in the browser, so a second
device reads the same way. Neither is the product's opinion — someone watching
what a server did wants the log, someone corresponding with people wants the
thread.

## Controls

Every control is the kit's, not a styled native element:

- `Choice` (`components/app/choice.tsx`) wraps Radix Select — the popover, the
  keyboard behaviour, and a hidden native select so `FormData` still reads the
  value. An uncontrolled Choice falls back to its first option, because a native
  `<select>` submits one and Radix's hidden field would otherwise start empty.
- `Switch` for a setting that is on or off, `Checkbox` for one of many.
- `Input` and `Textarea` everywhere, with `className="machine"` where the value
  is machine-assigned.
- `Field` labels are sentence case at `text-sm`, like the kit's `Label`. The
  uppercase `.field-label` is for column headers and fieldset legends only.
- `Modal` is the kit's `Dialog`: it owns its padding and renders the heading
  from its `title`, so the form inside carries neither.
- The single exception is `<input type="color">` in the folder editor: the kit
  ships no colour control, so that one native element stays and is dressed in
  the kit's height, radius and border.
- Toasts are Sonner, styled by the `[data-sonner-toast]` rules already in the
  palette. `useToast()` keeps the two verbs the app used before — `ok` and
  `fail` — over `toast.success` and `toast.error`.

## Compose

The envelope is rows, not stacked fields: label and value on one line, Cc and
Bcc behind a click, so the message itself starts above the fold. The footer is
sticky, ⌘↵ sends from inside the body, and the save state sits at its right —
`Unsaved changes` while typing, `Saving…`, then `Draft saved`.

Leaving with changes the autosave has not flushed opens the app's own dialog
(`Keep writing` / `Save and leave`) rather than the browser's; a tab close,
which the router never sees, still gets `beforeunload`.

## Type

Onest Variable and JetBrains Mono Variable, with the tracking scale from the
brandbook (`--tracking-display` … `--tracking-caps`).

Machine-assigned values — addresses, hostnames, DNS records, Message-IDs, key
prefixes, byte counts, timings — take `.machine`: mono, tabular figures. Prose a
person wrote never does, and `font-variant-numeric` is deliberately *not* set on
`body`, because tabular figures in running sans text open gaps.

`.display` is weight 600 at `--tracking-heading` with balanced wrapping.
`.field-label` is for column headers and fieldset legends **only** — never a
line above a heading. Headings carry their own weight; there are no kickers in this product.

## Motion

Pogpin's scale: `--motion-fast` 120ms, `--motion-medium` 180ms, `--motion-slow`
240ms, out on `cubic-bezier(0.2, 0, 0, 1)`.

One authored moment survives from Pogmail: `mark-draw`, the instance drawing its
own mark, staggered 55ms per stroke. The active-navigation pill is beUI's
shared-layout span, recoloured from outside to the brand surface rather than
forked.

Page transitions are a View Transition, and only the content region joins them —
and inside that region, only the part that actually changed. `main` is named
`page`, which lifts it out of the root snapshot so the
navigation never cross-fades against an identical copy of itself. The root pair
is stilled, except while beUI's theme toggle runs its own root reveal — that
stamps `data-beui-vt`, which the rule excludes.

Settings and Administration are the same component — `SectionLayout` — so their
width, their tab column and their heading cannot drift apart again; they had,
and moving between the two shifted the page sideways.

A section's heading and its tabs carry names of their own (`section-heading`,
`section-nav`), which lifts them out of the `page` snapshot into groups that
`styles.css` stills — the outgoing copy dropped to `opacity: 0` rather than
merely left un-animated, because an un-animated old snapshot stays painted for
the whole transition and would hang the section's tabs over the screen you moved
to. Switching a Settings tab therefore moves the panel the tab
controls and nothing else. The one scroll container also re-homes to the top when
the path changes, so a long screen never hands its scroll position to the short
one after it.

`prefers-reduced-motion` kills the draw and holds the finished mark.

## Themes

Light and dark are both written out in full; dark is not a filter over light.
The dark palette lives under `.dark`, and `ThemeProvider` in `main.tsx` supplies
that class (`attribute="class"`, `enableSystem`) for both an explicit choice and
the resolved system preference.

## Refused in this codebase

- Kickers or eyebrows above headings.
- Gradient text.
- Nested cards, and rows of identical stat tiles standing in for a dashboard.
- A coloured left border on rows, cards or callouts.
- Coral as an error, or any signal colour as decoration.
- Monospace as a costume for "technical" — it means machine-assigned data.
- Hue as the sole carrier of any state.

## Vendored components

Two vendored trees, both excluded from linting and never edited:

- `components/ui/` — the shadcn-on-Radix kit, copied from Pogpin's
  `shared/ui/`. Import from `@/client/components/ui`.
- `components/motion/` — the beUI registry, kept at the same revision Pogpin
  ships (the sidebar and command palette were re-copied from it, which is what
  moves the sheet breakpoint to `xl`). It speaks shadcn's names, which the
  palette already defines, so an installed component inherits the brand for
  free. Restyle from outside with `className` — see `ACTIVE` in
  `components/app/sidebar.tsx` for the pattern.

`components/app/button.tsx` is the seam between them: it maps the app's older
`primary`/`md` vocabulary onto the kit's `brand`/`default`, so `primary` is
coral and everything else is the neutral surface.

The primary navigation is composed from beUI's animated sidebar in full, not a
subset of it: `Rail` and the header toggle both drive `collapsible="icon"` (the
provider's own ⌘B still works), `Close` gives the mobile sheet a way out, and
mailboxes are a `MenuSub` disclosure rather than a second flat group.
