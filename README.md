# Token Tracker for AI Generation

A browser extension that tracks credit/token usage across AI-generation tools,
attributed **per user** and **per asset**, rolled up to a **brand**, with
refunds reconciled.

Editors often generate songs, videos, and images across several AI tools. This
extension observes each tool's activity in the browser and turns it into a clear
answer to: *how many credits went into this asset, and who spent them?*

## Tools supported

- **Flow** (Google, Veo-based video)
- **Higgsfield** (AI video / image)
- **Kling** (video)

Usage signals are extracted from each tool's network activity.

## Core concepts

- **Brand** — the top-level entity (an IP). All usage rolls up here.
- **Asset** — a song, video, or image created under a brand.
- **User** — an editor operating the tools in their own browser.
- **Generation event** — a single generate action that consumes credits/tokens.
- **Refund** — a charge later reversed; netted out of usage totals.

### Rules

- An **asset is shared across users**: when multiple editors work on the same
  asset, their usage aggregates to that same asset (and its brand).
- Attribution is **both** per-user **and** per-asset — not one or the other.
- Roll-up paths: `event → asset → brand`, and independently `event → user`.

## What each generation event records

`{ user, tool, brand, asset, tokens_or_credits, refunded }`

## What a user can see

- How many tokens/credits they've used per asset.

## Status

Early design. Key decisions still open:

1. **Architecture** — central backend (shared source of truth) vs. local-only
   vs. a raw capture probe with server-side parsing. *Leaning: central backend*,
   since a shared view and cross-user asset stitching need one.
2. **User identity** — how the current editor is identified per browser.
3. **Asset identity** — how the same asset is recognized across users/tools.
4. **Token signal per tool** — where credit/token numbers appear in each tool's
   network activity (Flow, Higgsfield, Kling).
5. **Refund detection** — distinct event, balance delta, or inferred? Per tool.

## Tech

Manifest V3 · TypeScript · **WXT** (extension) · **Next.js** (dashboard) ·
**Convex** (backend) · React + shadcn/ui + Tailwind · Biome · pnpm.
Coding standards live in `AGENTS.md`.

## Repo layout

```
apps/
  extension/   WXT + React — popup, background, content scripts
  dashboard/   Next.js — company-wide dashboard
packages/
  convex/      Convex backend: schema, queries, mutations
  shared/      Shared TS types (the generation-event schema)
```

## Development

Requires Node ≥ 22 and pnpm (via `corepack enable`).

```bash
pnpm install            # install all workspaces
pnpm dev:convex         # FIRST run — logs into Convex, provisions a dev
                        # deployment, and generates convex/_generated/
pnpm dev                # run extension + dashboard + convex together
```

Per-app: `pnpm dev:extension` (loads at `apps/extension/.output/`),
`pnpm dev:dashboard` (http://localhost:3001).

Quality gate (green before commit):

```bash
pnpm check              # Biome lint + format
pnpm typecheck          # tsc across workspaces
```

> Note: `packages/convex` only typechecks after `pnpm dev:convex` has generated
> `convex/_generated/` once (it's gitignored). Until then its typecheck is
> skipped with a notice.

### Adding shadcn/ui components

Both apps are shadcn-ready (`components.json` + `lib/utils.ts`). Add components
per app, e.g. `pnpm --filter @token-tracker/dashboard dlx shadcn@latest add button`.
