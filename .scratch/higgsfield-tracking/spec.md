# Spec: Higgsfield generation tracking (Phase 1)

Status: ready-for-agent
Labels: ready-for-agent

> Vocabulary is the project glossary (`CONTEXT.md`). Decisions here respect
> `docs/adr/0001`–`0004`. Schema is `@token-tracker/shared` + Convex (AGENTS.md §6).

## Problem Statement

An Organization's editors generate images and videos on Higgsfield, spending
shared credits from a shared tool seat (e.g. a shared `aibusiness@…` account). Today
nobody can answer: *how many credits went into this Asset, and which editor
spent them?* The tool attributes nothing to a Brand, an Asset, or an individual
editor — its own `project_id` is constant across every generation — and when a
generation fails and its credits are refunded, that reversal is invisible. There
is also no single place for an editor to see the generations they've produced.

## Solution

A browser extension observes Higgsfield's network traffic (observe-only, never
blocking) and turns each generate action into a **Generation event** attributed
to the current editor (**User**) and to the **Active Asset** they selected in the
popup, rolled up to that Asset's **Brand** and the **Organization**. Each event
captures the credits charged (**Cost**), the prompt, and the **Result media**
links, so editors get a **generation gallery** of their work per Asset. When a
generation can't be confidently attributed or classified, it is recorded as a
**Flagged anomaly** (never guessed) — including `unattributed` generations the
editor can later **assign** to an Asset from the gallery. All raw Higgsfield API
traffic is additionally retained verbatim so unknown signals (refunds, batch
cost) can be discovered later (ADR-0001) and so every derived number is
replayable.

## User Stories

1. As an editor, I want the extension to record each Higgsfield generation
   automatically, so that I don't have to log credit usage by hand.
2. As an editor, I want to pick the Brand and Asset I'm working on in the popup,
   so that my generations are attributed to the right Asset.
3. As an editor, I want the popup to clearly show the currently Active Asset, so
   that I don't accidentally attribute work to yesterday's Asset.
4. As an editor, I want a generation I make with no Active Asset selected to
   still be recorded (as `unattributed`), so that a real charge is never lost.
5. As an editor, I want to see my `unattributed` generations flagged for
   assignment, so that I can clean them up later.
6. As an editor, I want to assign an `unattributed` generation to an Asset from
   the generation gallery, so that it rolls up correctly.
7. As an editor, I want to see a gallery of my generations with their prompt and
   output image/video, so that I can review what I've produced.
8. As an editor, I want to see the generations for a given Asset, so that I can
   see everything that went into it.
9. As an editor, I want each generation to show its Cost in credits, so that I
   understand what I spent.
10. As an editor, I want free generations (the tool charged nothing) recorded at
    Cost 0, so that usage counts are complete without inflating spend.
11. As a brand owner, I want usage to roll up Asset → Brand → Organization, so
    that I can see total credit spend per Brand.
12. As a brand owner, I want per-Asset net usage (charges minus refunds), so that
    refunded generations don't overstate what an Asset cost.
13. As a team lead, I want usage attributed per editor independently of the Asset
    axis, so that I can see who spent what.
14. As a team lead, I want editors identified by our own login, not the shared
    Higgsfield seat, so that editors sharing one tool account are still told
    apart (ADR-0004).
15. As an admin, I want every event scoped to exactly one Organization and every
    query filtered by it, so that tenants are strictly isolated.
16. As an editor, I want a generation whose credit cost I can see in the response
    recorded with that exact Cost, so that the number matches what the tool
    actually charged.
17. As an operator, I want the button's displayed cost captured alongside the
    response cost, so that a discount/promo discrepancy is visible rather than
    silent.
18. As an operator, I want a generation whose button cost disagrees with the
    response cost recorded as a Flagged anomaly, so that we can investigate
    mispricing.
19. As an operator, I want a Generate click that produces no matching generate
    request recorded as a Flagged anomaly, so that cancelled/failed-silently
    attempts are visible.
20. As an operator, I want a generation with a Job status we've never seen
    recorded as a Flagged anomaly rather than guessed, so that billing logic
    stays deterministic (ADR-0002).
21. As an editor generating a batch of N outputs, I want one Generation event
    (one Job set) holding N Jobs, so that a single click is one charge with N
    outputs.
22. As an editor, I want each Job in a batch to carry its own status and output
    media, so that a partly-failed batch is represented accurately.
23. As an operator, I want all `fnf-api-gw.higgsfield.ai` traffic retained
    verbatim (request + response bodies), so that unknown signals can be found
    later and derived events recomputed.
24. As a security-conscious operator, I want auth/analytics hosts
    (`clerk`/`kopir`/`cms`/`sentry`) never captured and request headers dropped,
    so that no tool secret is ever stored.
25. As an operator, I want each event stamped with the version of the detection
    rule that produced it, so that a bad rule's blast radius is queryable
    (ADR-0003).
26. As an editor, I want my generation to appear in the gallery as soon as the
    generate response returns, so that I see it immediately even before the
    output finishes rendering.
27. As an editor, I want the gallery to update a generation from queued →
    in_progress → completed with its final media, so that I can watch it finish.
28. As an operator, I do not want the extension to block, delay, or modify any
    Higgsfield request, so that the editor's workflow is never disturbed
    (observe-only, AGENTS.md §5).

## Implementation Decisions

**Modules built/modified**

- `packages/shared` — extend `GenerationEvent`: add `organizationId`,
  `assetId: string | 'unattributed'`, `prompt?`, `jobs: JobOutcome[]`,
  `toolAccount?`, `ruleVersion`; add `JobOutcome`
  (`jobId`, `status: 'queued'|'in_progress'|'completed'|'failed'`, `mediaUrl?`).
  Keep `RefundState` unchanged. This is the single source of truth (AGENTS.md §6).
- `apps/extension/lib/tools/higgsfield.ts` — implement the adapter (currently a
  stub). Two responsibilities behind the existing `ToolAdapter.extract()` seam:
  (a) recognize the **generate response** (`POST /fnf/jobs/{type}` or
  `/fnf/jobs/v2/{type}`) and extract `cost` (from `job_sets[].cost`; `null` ⇒ 0),
  `toolRef` (job-set id), the child job ids + prompt; (b) recognize **status
  responses** (`GET /fnf/jobs/{id}`, `POST /fnf/jobs/status-batch`) and produce
  Job outcome updates (status + `results.raw.url` media). Adapter output stays
  attribution-free (it cannot know user/brand/asset).
- `apps/extension/lib/tools/types.ts` — widen `ExtractedUsage` to carry the Job
  set shape (child jobs, prompt) and to distinguish a *new generation* extract
  from a *status update* extract.
- `apps/extension/entrypoints/background.ts` — fill the TODO: resolve the Active
  Asset context, run the **attribution + flagging** pure function, then call the
  Convex mutations. Correlate status updates to the originating event by
  `toolRef` / job id.
- `apps/extension/entrypoints/popup` — Active Asset selector (Org → Brand →
  Asset), prominent display of the current Active Asset, and the **generation
  gallery** (prompt + Result media, per editor and per Asset) with an **assign**
  action for `unattributed` generations.
- `apps/extension/entrypoints/patch.content.ts` + `lib/messaging.ts` — narrow
  capture host scope to `fnf-api-gw.higgsfield.ai`; drop request headers;
  capture request method/url/body (the current patch hardcodes `method:'GET'` —
  fix so POST generate calls are captured with their body). Retain raw captures.
- `apps/extension/entrypoints/*.content.ts` — a **click tripwire**: observe
  Generate-button clicks so a click with no subsequent generate request becomes a
  Flagged anomaly. (Kept minimal; DOM touch as small as possible.)
- `packages/convex/convex/schema.ts` + `events.ts` — mirror the extended shape;
  add `organizationId` and indexes for the new roll-up (`by_org`,
  `by_org_brand`); add a **raw captures** table (append-only) and a **flagged
  anomalies** table; add an `assignAsset` mutation (move `unattributed` → an
  Asset) and gallery queries (`generationsByUser`, `generationsByAsset`).

**Attribution + flagging (new pure seam)**

- `attribute(extracted, activeContext) → GenerationEvent | FlaggedAnomaly`.
  Active context = `{ organizationId, userId, brandId, assetId }` from the popup
  selection + our login. Rules: no Active Asset ⇒ `assetId: 'unattributed'` +
  `needs-assignment` flag; button cost ≠ response cost ⇒ record event **and**
  flag; unknown Job status ⇒ flag; response cost present ⇒ that is the billed
  Cost (button is metadata only).

**Contracts / interactions**

- Event granularity: **one Generation event = one Higgsfield Job set** (ADR
  context in `CONTEXT.md`); `toolRef` = job-set id.
- Cost: authoritative from the generate **response** `cost`; the button number is
  captured only for cross-check (stored as metadata / anomaly trigger).
- Outcome observation is **passive** — read the statuses off Higgsfield's own
  polling traffic; the extension issues no Higgsfield requests of its own.
- Identity: `userId` from our extension login; `toolAccount` (shared seat) is
  metadata (ADR-0004). Everything scoped to one `organizationId` (single-tenant).
- Detection rules are **pure, replayable functions over retained raw captures**,
  each stamped with `ruleVersion` (ADR-0003).

## Testing Decisions

Good tests here assert **external behavior** — given a captured response, what
event/anomaly comes out — never internal structure. Three seams, confirmed with
the developer:

1. **`higgsfieldAdapter.extract()` (primary, existing seam).** Fixture-based unit
   tests using the **real captured HARs** in `input/higgsfield/` (paid image,
   free image, both videos), secrets stripped, per AGENTS.md §9. Cases: paid image
   generate ⇒ `cost:100`, job-set `toolRef`, prompt, one Job; free generate ⇒
   `cost:0`; video generate (`kling2_6` ⇒ 500, `kling3_0_turbo` ⇒ 750); a
   `GET /fnf/jobs/{id}` status ⇒ a Job outcome update with media URL on
   `completed`; a non-matching response (e.g. `/fnf/user`, `/tours`) ⇒ `null`.
2. **`attribute()` (new pure seam).** Unit tests: with Active Asset ⇒ event
   stamped org/user/brand/asset; without ⇒ `unattributed` + `needs-assignment`;
   cost mismatch ⇒ event + flag; unknown status ⇒ flag.
3. **Convex roll-up math (existing seam).** `convex-test` over `usageByAsset` (and
   the new org/brand roll-ups): net = charges − refunds; refunded events reduce
   the total; `unattributed` events roll to Brand but not to any Asset.

Prior art: the existing `events.ts` roll-up reducer and the `ToolAdapter`
interface. The DOM/network/messaging/React glue is intentionally **not**
unit-tested (test the pure core, not the glue).

## Out of Scope

- **Refund/failure detection.** Parked behind discovery (ADR-0001) — no
  failed/refunded generation has been captured. Runtime **flags** such cases
  (ADR-0002); `RefundState` stays `none`/`pending` and no automated refund rule
  ships in this spec.
- **The Discovery agent** (Python/LangGraph, ADR-0003) — separate offline
  tooling; not built here.
- **Flow and Kling adapters** — need their own captures; Higgsfield only.
- **Whether `cost` scales with batch size** — needs a multi-output capture; the
  adapter reads `cost` as the whole-set total until proven otherwise.
- **Brand/Asset/Org management CRUD and auth provisioning** — assumed to exist or
  stubbed; this spec consumes the Active Asset selection, it doesn't build org
  administration.
- **The web dashboard's full roll-up UI** — the popup gallery is in scope; the
  Next.js dashboard beyond reusing the same Convex queries is deferred.
- **XHR capture** — Higgsfield uses `fetch`; patching `XMLHttpRequest` is
  deferred (noted TODO in the patch).

## Further Notes

- Two captures unblock later phases (tracked as follow-ups, not blockers here):
  a **failed → refunded** generation, and a **multi-output** generation.
- The generate response returns immediately with `cost` + ids, so an event can be
  created at response time and then enriched as passive status polls arrive —
  correlate by `toolRef` / job id.
- Observed reference: paid image `POST /fnf/jobs/v2/nano_banana_2_lite` →
  `job_sets[0].cost = 100`, `job_sets[0].id` = job-set `toolRef`,
  `jobs[0].id` polled via `GET /fnf/jobs/{id}` (`queued → in_progress →
  completed`, media at `results.raw.url`). Balance lives at `GET /fnf/user`.
