# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- Two web surfaces share this record: the WXT browser-extension (popup +
generation gallery) and the Next.js dashboard. Both are web technology; neither
is a native app. Stack is locked in AGENTS.md §1, so no ## Stack section here. -->

## Users

- **Editor** (primary, extension) — a person who generates songs, videos, and
  images across several AI tools (Flow, Higgsfield, Kling) in their own browser,
  often while signed into a *shared* tool seat (e.g. a shared `aibusiness@`
  Higgsfield account). They belong to one Organization and are identified by
  their own login to our extension, never by the shared tool account. Their job
  in the moment is generating creative work; the tracker must observe without
  interrupting that. What they need to see: how many credits went into each
  Asset, and their own usage.
- **Studio lead / manager** (primary, dashboard) — reads company-wide roll-ups
  to answer "how many credits went into this asset/brand, and who spent them?"
  across editors. Navigates the roll-up in both directions: Asset → Brand →
  Organization, and independently by User. May be the same person as an editor
  in a small studio; the dashboard serves the roll-up view either way.

## Product Purpose

**Show token/credit usage two ways — per editor and per asset.** That is the
core job: turn each AI-generation tool's in-browser activity into a clear,
auditable answer to *how many credits/tokens each editor spent* and *how many
went into each Asset*. Credit spend across multiple AI tools is otherwise
invisible per deliverable and per person — especially when editors share a
single tool seat. Both views roll up further (Asset → Brand → Organization),
but the editor-wise and asset-wise totals are the headline. Success is a usage
figure for any User or Asset that a studio can trust, explain, and reconcile
against refunds.

## Positioning

- **Passive, per-browser capture, not an API integration.** Usage is read from
  each tool's own network traffic in the editor's browser (MV3 content script →
  MAIN-world `fetch`/XHR patch → background → Convex), observing only — never
  blocking or altering the tool's requests. This works even where a tool exposes
  no usage API and where a seat is shared.
- **Attribution on two independent axes at once** — per-User *and* per-Asset,
  rolled up to Brand and Organization — decoupled from the shared tool account
  a generation happened to run under. A neighboring "usage dashboard" that reads
  the tool's own account cannot separate editors sharing one seat (ADR-0004).
- **Deterministic, auditable billing path.** What gets attributed to an Asset is
  computed by pure TypeScript/Convex with no LLM in the path; ambiguous cases
  are flagged with raw evidence, never guessed (ADR-0002). Totals are
  reproducible and explainable.

## Operating Context

- Editors work inside the AI tools' own web apps; the extension popup surfaces
  the **Active Asset** selection and per-Asset usage without pulling them out of
  their flow. Generations with no Active Asset are captured as
  `unattributed` and assigned later.
- **Generation gallery** — the frontend where an editor sees their generations
  (prompt + result media) per Asset, and performs **Assignment**: attaching an
  `unattributed` generation event to an Asset (resolves the `needs-assignment`
  flag).
- **Dashboard** — company-wide roll-ups (Brand → Asset → User, and by User) for
  studio leads.
- Multiple editors work the **same Asset**; their usage aggregates to it and its
  Brand. Data is isolated strictly per Organization (single-tenant).
- Terminology is governed by `CONTEXT.md` (glossary) — Organization, Brand,
  Asset, User, Generation event, Cost, Refund, Job set, Job, Assignment,
  Flagged anomaly, Result media — and must be used consistently in UI copy.

## Capabilities and Constraints

- **Supported tools:** Flow (Google, Veo video), Higgsfield (AI video/image),
  Kling (video). Adding a tool = adding one adapter behind a shared interface.
- **Recorded unit** is a **Generation event** (canonical shape in
  `packages/shared`, mirrored by Convex validators — see AGENTS.md §6):
  `{ organizationId, userId, tool, brandId, assetId | 'unattributed', cost,
  prompt?, jobs[], refund, toolAccount?, toolRef, ruleVersion, capturedAt }`.
  A Higgsfield event maps to one **Job set** (carries `cost`) grouping one or
  more **Jobs** (one per output; each has a status and, when completed, result
  media URL).
- **Refund** is a state transition on the original event, never a deletion;
  netted out of totals. Modeled as a discriminated union
  (`none | pending | refunded`).
- **Phase 1 is a capture probe** (ADR-0001): observe and log all
  `fnf-api-gw.higgsfield.ai` traffic (raw request/response) to Convex, to
  discover the still-unknown signals — how refunds appear, and whether `cost`
  scales with batch size — before finalizing the structured model. Phase 1 is
  deliberately throwaway-ish; its value is discovery.
- **Detection self-heals offline** (ADR-0003): a Python + LangGraph Discovery
  agent consumes flagged anomalies + retained raw logs and emits *versioned,
  replayable detection code* for the Higgsfield adapter — never live per-event
  verdicts, never in the billing path. Rules auto-ship with after-the-fact
  audit; every event is stamped with the `ruleVersion` that produced it.
- **Extension constraints (MV3, AGENTS.md §5):** least-privilege host
  permissions scoped to the three tools only (no `<all_urls>`); observe-only
  (never block/modify tool requests); no secrets in the public bundle; minimal
  page touch, no global CSS injection.
- **Locked stack** (AGENTS.md §1): WXT + React + shadcn/ui + Tailwind
  (extension), Next.js App Router + shadcn/ui + Tailwind (dashboard), Convex as
  source of truth, TypeScript strict (no `any`), Biome, pnpm workspaces.
- **Undecided / to be discovered:** exact refund signal shape; whether `cost`
  scales with output count; Job failure-status strings; Flow and Kling adapters
  (Higgsfield is the Phase-1 focus).

## Brand Commitments

- **Name is not yet committed.** Working title: "Token Tracker for AI
  Generation". Candidate under consideration: `generative-ai-credit-tracker`.
  Design work should treat the name as provisional — do not build a fixed
  logotype or wordmark identity around either until the name is confirmed.
- No committed logo, color, typography, or voice constraints exist yet. (These
  are visual-world decisions and belong in DESIGN.md via new-work, not here.)

## Evidence on Hand

- **Product documentation (real):** `README.md`, `CONTEXT.md` (glossary),
  `AGENTS.md` (locked standards + data model §6), four ADRs under `docs/adr/`,
  and the Higgsfield Phase-1 spec at `.scratch/higgsfield-tracking/spec.md`.
- **Code (stubs):** `packages/shared/src/index.ts`, `packages/convex/convex/`
  (`schema.ts`, `events.ts`), extension entrypoints/adapters under
  `apps/extension/`, and placeholder UI on both surfaces
  (`apps/dashboard/app/page.tsx`, `apps/extension/entrypoints/popup/App.tsx`).
- **No real captured data yet.** There are no traffic captures, usage numbers,
  result-media samples, or fixtures in the repo. Future design work must use
  clearly synthetic placeholder data and must **not** fabricate real usage
  figures, credit totals, editor names, or brand/asset examples.

## Product Principles

- **Observe, never interfere.** The tracker reads the tools' traffic and never
  blocks or alters it; the strongest action the runtime takes is *flag*.
- **Attribute on both axes, decoupled from the tool seat.** Per-User and
  per-Asset attribution is the core value; identity comes from our login, not
  the shared tool account.
- **Billing numbers must be reproducible.** Deterministic runtime, raw captures
  retained, every event stamped with its rule version; flag ambiguity with
  evidence instead of guessing.
- **Refunds are corrections, not erasures.** Charges reversed by a tool are
  recorded as state transitions and netted out — history stays auditable.
- **Discover before structuring.** Capture unknown signals in real traffic first
  (Phase 1) rather than designing the model blind.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established. Default to
the craft floor's baseline (keyboard operability, sufficient contrast, honoring
reduced-motion) on both surfaces until a specific standard is set.
