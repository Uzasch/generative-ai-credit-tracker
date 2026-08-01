# AGENTS.md — Standards for Token Tracker for AI Generation

Canonical engineering standards for this repo. **Every coding agent (Claude
Code, Codex, Cursor, …) must follow this file.** `CLAUDE.md` points here; do not
duplicate standards elsewhere. See `README.md` for what the product is.

Standards are contracts: keep them **checkable**, not vibes. When you add a rule,
phrase it so a reviewer can verify pass/fail from the diff.

---

## 1. Stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Extension framework | **WXT** | MV3, file-based entrypoints, HMR, cross-browser |
| Language | **TypeScript**, strict | No `any` (see §4) |
| Backend / data | **Convex** | TS-native, reactive, transactional. Source of truth |
| Popup UI | **React + shadcn/ui + Tailwind** | In-browser per-asset view |
| Web dashboard | **Next.js (App Router) + shadcn/ui + Tailwind** | Company-wide roll-ups |
| Lint + format | **Biome** | One tool, replaces ESLint + Prettier |
| Package manager | **pnpm** (workspaces) | Monorepo installs |

If a locked choice must change, update this table in the same PR and say why.

## 2. Repo layout (pnpm-workspace monorepo)

```
apps/
  extension/     WXT + React + shadcn — popup, background, content scripts
  dashboard/     Next.js + shadcn — company-wide dashboard
packages/
  convex/        Convex backend: schema, queries, mutations, actions
  shared/        Shared TS types (event schema, tool enums) — imported by all
```

- **Cross-cutting types live in `packages/shared`.** The generation-event shape
  (§6) is defined once here and imported everywhere — never re-declared.
- Extension and dashboard both talk to the **same Convex deployment**.

## 3. Commands

Establish these in root `package.json` / turbo (fill in as scaffolded):

- `pnpm install` — install all workspaces
- `pnpm dev` — run extension + dashboard + convex dev together
- `pnpm --filter extension dev` — WXT dev with auto-reload
- `pnpm check` — `biome check` (lint + format) across the repo — must pass clean
- `pnpm typecheck` — `tsc --noEmit` across workspaces — must pass clean

`pnpm check` and `pnpm typecheck` are the pre-commit gate. Green before commit.

## 4. TypeScript standards

- `strict: true`. **No `any`** — use `unknown` + narrowing at boundaries.
- Parse external data (network captures, Convex args) with a schema validator
  (Convex validators server-side; a runtime check before trusting captured
  tool responses). Never cast untrusted JSON straight to a type.
- Model states as **discriminated unions**, not booleans-with-flags. Refund
  status, tool kind, and event kind are unions.
- Prefer `type` for data shapes; no enums — use string-literal unions.
- No default exports except where a framework demands it (Next pages, WXT
  entrypoints).

## 5. Browser-extension standards (MV3)

- **Least privilege permissions.** Every entry in the manifest's `permissions`
  and `host_permissions` needs a one-line justification comment. No `<all_urls>`
  — scope hosts to the three tools only.
- **Reading token/credit numbers from tool traffic:** MV3 `webRequest` cannot
  read response bodies. Standard approach: a content script injects a small
  script into the page's **MAIN world** that monkey-patches `fetch`/`XHR`,
  reads the relevant responses, and `postMessage`s the extracted numbers to the
  content script → background → Convex. **Never block or modify** the tool's
  requests — observe only.
- Per-tool capture logic is isolated behind one interface (one adapter per tool:
  Flow, Higgsfield, Kling). Adding a tool = adding an adapter, nothing else.
- No secrets in the extension bundle. It is public, inspectable code.
- Content scripts touch the page as little as possible; no global CSS injection.

## 6. Data model (source of truth = Convex)

Core recorded unit is a **generation event**. Canonical shape lives in
`packages/shared`; Convex `schema.ts` mirrors it with validators.

```ts
type GenerationEvent = {
  userId: string;        // the editor who triggered it
  tool: 'flow' | 'higgsfield' | 'kling';
  brandId: string;       // IP / brand — top-level roll-up
  assetId: string;       // song / video / image; shared across users
  cost: number;          // tokens or credits consumed
  refund: RefundState;   // discriminated union, see below
  capturedAt: number;    // client ms epoch
  toolRef?: string;      // tool-side job/request id, for reconciliation
};

type RefundState =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'refunded'; amount: number; at: number };
```

- Roll-ups: `event → asset → brand`, and independently `event → user`. Compute
  these as Convex queries; do not denormalize prematurely.
- **Refunds net out, never delete.** A refund is a state transition on the
  original event (or a linked reversing entry) so history stays auditable.
- Writes that must be consistent (charge + refund reconciliation) go through a
  single Convex **mutation**, never multiple client round-trips.

## 7. UI standards (popup + dashboard)

- shadcn/ui components + Tailwind. Don't hand-roll what shadcn provides.
- Keep components presentational; data comes from Convex hooks
  (`useQuery`/`useMutation`). No fetch logic inside components.
- Accessible by default: labelled controls, keyboard-navigable, sufficient
  contrast. Tables (tokens per asset/user) use semantic markup.
- Theme-aware (light/dark) via Tailwind + shadcn tokens.

## 8. Formatting & conventions

- **Biome** owns formatting and lint. Do not add ESLint/Prettier. Run
  `biome check --write` before committing.
- Conventional Commits (`feat:`, `fix:`, `chore:`, …). One logical change per
  commit.
- Match surrounding code: naming, file structure, comment density. Comments
  explain *why*, not *what*.

## 9. Testing

- Business logic (cost extraction, refund reconciliation, roll-up math) is
  pure and unit-tested. Per-tool adapters have fixture-based tests using real
  captured response samples (secrets stripped).
- Prefer testing the pure core over the DOM/network glue.

---

## Open questions (resolve before the code depends on them)

1. **User identity** — how is the current editor identified per browser (SSO,
   extension login, org directory)? Drives `userId`.
2. **Asset identity** — how is the *same* asset recognized across users/tools?
   Is there a shared project/asset id, or is it assigned in-app? Drives
   `assetId` — the crux of cross-user aggregation.
3. **Per-tool token signal** — exact request/response fields carrying the cost
   number, per tool. Needs captured samples for Flow, Higgsfield, Kling.
4. **Refund detection** — distinct event, balance delta, or inferred? Per tool.
   Drives the `RefundState` transitions.

Keep these in sync with `README.md`'s Status section.
