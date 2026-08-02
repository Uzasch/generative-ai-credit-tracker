import {
  type JobStatus,
  type RefundMismatch,
  assertRefundAmount,
  collectAnomalyRefs,
  crossCheckRefund,
  isEventFlagged,
  isFailureStatus,
  refundForStatus,
} from '@token-tracker/shared';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { resolveAssetBrand } from './catalog';
import { toGenerationView, toRecentGeneration } from './gallery';
import { sumNet } from './rollups';

const refundState = v.union(
  v.object({ kind: v.literal('none') }),
  v.object({ kind: v.literal('pending') }),
  v.object({ kind: v.literal('refunded'), amount: v.number(), at: v.number() }),
);

const assignmentState = v.union(
  v.object({ status: v.literal('assigned') }),
  v.object({ status: v.literal('needs-assignment') }),
);

const jobStatus = v.union(
  v.literal('queued'),
  v.literal('in_progress'),
  v.literal('completed'),
  v.literal('failed'),
  // Content-safety rejection; a non-`completed` terminal failure (mirrors
  // JOB_STATUSES / FAILURE_STATUSES in @token-tracker/shared).
  v.literal('nsfw'),
);

const jobOutcome = v.object({
  jobId: v.string(),
  status: jobStatus,
  mediaUrl: v.optional(v.string()),
});

/**
 * How far a job has progressed, for ordering out-of-order status polls. Passive
 * polls can arrive late; a job never moves backwards and, once terminal, never
 * changes again. Every terminal status — `completed` and the failures
 * (`failed`, `nsfw`) — shares the terminal rank.
 */
const STATUS_RANK: Record<JobStatus, number> = {
  queued: 0,
  in_progress: 1,
  completed: 2,
  failed: 2,
  nsfw: 2,
};

/** Record a single generation event captured by the extension. */
export const record = mutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    tool: v.union(v.literal('flow'), v.literal('higgsfield'), v.literal('kling')),
    brandId: v.string(),
    assetId: v.string(),
    prompt: v.optional(v.string()),
    cost: v.number(),
    jobs: v.optional(v.array(jobOutcome)),
    refund: v.optional(refundState),
    assignment: v.optional(assignmentState),
    capturedAt: v.number(),
    toolRef: v.optional(v.string()),
    toolAccount: v.optional(v.string()),
    ruleVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const { refund, jobs, assignment, ...rest } = args;
    // A refund amount is a client-influenced magnitude (it originates in captured
    // tool traffic), so bound it at the write boundary — Convex field validators
    // are structural and can't reject NaN/Infinity/negative (shared §refund).
    if (refund?.kind === 'refunded') assertRefundAmount(refund.amount);
    // The assignment flag mirrors the `'unattributed'` assetId sentinel
    // (AGENTS.md §6). Derive the expected value here — this is the source of
    // truth's write boundary — so a contradictory event can never be persisted:
    // default to the derived value when omitted, and reject a mismatched one.
    const expected = rest.assetId === 'unattributed' ? 'needs-assignment' : 'assigned';
    if (assignment && assignment.status !== expected) {
      throw new Error(
        `assignment '${assignment.status}' contradicts assetId '${rest.assetId}' (expected '${expected}')`,
      );
    }
    return await ctx.db.insert('events', {
      ...rest,
      jobs: jobs ?? [],
      refund: refund ?? { kind: 'none' },
      assignment: { status: expected },
    });
  },
});

/**
 * Mark a prior event refunded. A refund is a state transition on the original
 * event so history stays auditable (AGENTS.md §6). Reconciled by toolRef.
 */
export const markRefunded = mutation({
  args: { toolRef: v.string(), amount: v.number(), at: v.number() },
  handler: async (ctx, { toolRef, amount, at }) => {
    // Bound the client-influenced magnitude before it enters the billing path
    // (reject NaN/Infinity/negative; shared §refund).
    assertRefundAmount(amount);
    const event = await ctx.db
      .query('events')
      .withIndex('by_tool_ref', (q) => q.eq('toolRef', toolRef))
      .unique();
    if (!event) return null;
    await ctx.db.patch(event._id, { refund: { kind: 'refunded', amount, at } });
    return event._id;
  },
});

/**
 * Apply a passively-observed job status to the event that owns the job (issue
 * #4). A status poll carries only the job id, its status, and — on completion —
 * the result media URL; it has no event, org, or asset context. We correlate by
 * locating the event whose `jobs[]` contains `jobId` and patch that one
 * outcome, leaving its siblings untouched.
 *
 * Status never moves backwards: out-of-order polls are common, so a poll that
 * would regress a job is ignored, and once a job is terminal (completed/failed)
 * its status is frozen — the first terminal outcome wins. Media, however, is
 * only ever added and can still attach to an already-terminal job (a completed
 * job first seen without its `results.raw.url` gains the link from a later
 * poll); it is never cleared by a status-only poll. Returns the patched event
 * id, or `null` when no job matched or the poll changed nothing.
 *
 * A job advancing to a non-`completed` terminal status (`failed`, `nsfw`) means
 * the tool refunded the full job-set `cost`, so the same patch transitions the
 * event's `RefundState` to `refunded { amount: cost, at }` and its net usage
 * becomes 0 (issue #17; finding refund-signal-nsfw.md rule 2). The refund is a
 * state transition, never a delete (AGENTS.md §6); the first terminal outcome
 * wins, so an already-`refunded` event is left untouched. The wallet
 * `subscription_balance` delta independently cross-checks this amount out of band
 * (see {@link crossCheckWalletRefund}), because that refund lands a few seconds
 * after the terminal status (finding rule 4). Single-job-set case only —
 * partial-batch refunds are parked (spec/ADR-0001).
 *
 * Correlation is scoped to one Organization (AGENTS.md §6 — every query filters
 * by `organizationId`; ADR-0004 strict single-org isolation) and then scans that
 * org's events for the one whose `jobs[]` contains `jobId`: a job id cannot be
 * indexed as an array element in Convex, and the spec's "do not denormalize
 * prematurely" (AGENTS.md §6) rules out a jobId→event side table in Phase 1. The
 * background supplies the org from the same attribution context it recorded the
 * event with. If per-org poll volume makes the scan costly, that side table is
 * the documented follow-up.
 */
export const applyJobStatus = mutation({
  args: {
    organizationId: v.string(),
    jobId: v.string(),
    status: jobStatus,
    mediaUrl: v.optional(v.string()),
    // When this poll drives a refund transition, the time to attribute it to —
    // the extension's capture time for the terminal-status poll. Optional so
    // non-terminal polls (the common case) need not supply it; the refund lands
    // a few seconds later regardless (finding rule 4) and is cross-checked then.
    at: v.optional(v.number()),
  },
  handler: async (ctx, { organizationId, jobId, status, mediaUrl, at }) => {
    const events = ctx.db
      .query('events')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId));
    for await (const event of events) {
      const current = event.jobs.find((job) => job.jobId === jobId);
      if (current === undefined) continue;

      // Advance the status only when it moves strictly forward; equal-or-lower
      // ranks (a stale poll, a second terminal state) leave the status frozen.
      const nextStatus =
        STATUS_RANK[status] > STATUS_RANK[current.status] ? status : current.status;
      // Media is additive: a newly-observed URL wins, otherwise keep what we had.
      const nextMediaUrl = mediaUrl ?? current.mediaUrl;

      // Nothing to do if neither the status nor the media actually changed.
      if (nextStatus === current.status && nextMediaUrl === current.mediaUrl) return null;

      const jobs = event.jobs.map((job) =>
        job.jobId === jobId
          ? {
              jobId: job.jobId,
              status: nextStatus,
              ...(nextMediaUrl !== undefined ? { mediaUrl: nextMediaUrl } : {}),
            }
          : job,
      );

      // A job that just advanced into a non-`completed` terminal ⇒ the tool
      // refunded the full job-set cost (finding rule 2). Fold that transition
      // into the same patch. The first terminal outcome wins, so a job already
      // refunded is left alone; `cost` is bounded before it becomes the amount.
      //
      // Single-job case only (`jobs.length === 1`): `event.cost` is the whole
      // job set's cost, so refunding it in full is correct only when the failing
      // job *is* the whole set. For a multi-job set, one failing job does not
      // mean the entire set was refunded — refunding `event.cost` would
      // over-refund the siblings that may still succeed. Partial-batch
      // reconciliation (per-job refunds netting into the amount) is deferred
      // (spec/ADR-0001, finding refund-signal-nsfw.md); until then a multi-job
      // set's refund state is left unchanged here.
      const refund =
        event.jobs.length === 1 &&
        nextStatus !== current.status &&
        isFailureStatus(nextStatus) &&
        event.refund.kind !== 'refunded'
          ? refundForStatus(nextStatus, assertRefundAmount(event.cost), at ?? Date.now())
          : null;

      await ctx.db.patch(event._id, refund ? { jobs, refund } : { jobs });
      return event._id;
    }
    return null;
  },
});

/**
 * Assignment (CONTEXT.md): attach an Unattributed Generation event to a real
 * Asset, resolving its `needs-assignment` flag. This is the gallery's triage
 * action (issue #7) — the editor's "accession stamp".
 *
 * Moves `assetId`, `brandId` and `assignment` together. The target Asset's Brand
 * is resolved from the Org → Brand → Asset catalog (`resolveAssetBrand`, issue
 * #5's Asset↔Brand↔Org source of truth) and stamped alongside the id, so the
 * event's Brand can never disagree with the Asset it was filed under: an
 * unattributed event's capture-time `brandId` may be stale/wrong, and leaving it
 * would make the Asset and Brand roll-ups contradict each other. The two id
 * fields move with the flag, so the ADR-0006 assetId↔assignment invariant the
 * `record` write boundary enforces still holds.
 *
 * The `'unattributed'` sentinel is not an Asset (CONTEXT.md) and is refused as a
 * target. Both the event *and* the target Asset must belong to the caller's
 * Organization (AGENTS.md §6, ADR-0004): an event owned by another Org is never
 * touched, and a target Asset absent from this Org's catalog — unknown, or owned
 * by a different Organization/Brand — is rejected rather than filed with a stale
 * Brand. Re-filing an event under the Asset it already holds is an idempotent
 * no-op (safe for a double-submit in batch triage); re-attributing an
 * already-assigned event to a *different* Asset is out of scope.
 */
export const assignAsset = mutation({
  args: {
    organizationId: v.string(),
    eventId: v.id('events'),
    assetId: v.string(),
  },
  handler: async (ctx, { organizationId, eventId, assetId }) => {
    if (assetId === 'unattributed') {
      throw new Error("cannot assign to the 'unattributed' sentinel; choose a real Asset");
    }
    const event = await ctx.db.get(eventId);
    // Org-scope the lookup rather than trusting the id alone (ADR-0004).
    if (!event || event.organizationId !== organizationId) {
      throw new Error('event not found in this Organization');
    }
    // Resolve the target Asset's Brand within THIS Organization. A target absent
    // from the org's catalog is unknown or belongs to another Organization/Brand:
    // reject it (never file an event onto a cross-org/cross-brand Asset), and use
    // the resolved Brand to overwrite the possibly-stale capture-time `brandId` so
    // the Asset and Brand roll-ups agree.
    const brandId = resolveAssetBrand(organizationId, assetId);
    if (brandId === null) {
      throw new Error(`Asset '${assetId}' not found in this Organization`);
    }
    if (event.assignment.status === 'assigned') {
      if (event.assetId === assetId) return eventId; // idempotent re-file
      throw new Error(
        're-attributing an already-assigned event to a different Asset is out of scope',
      );
    }
    // Move assetId, brandId and the flag as one so the roll-ups stay consistent
    // and the ADR-0006 assetId↔assignment invariant holds.
    await ctx.db.patch(eventId, { assetId, brandId, assignment: { status: 'assigned' } });
    return eventId;
  },
});

/**
 * Independent wallet cross-check of a recorded refund (issue #17, finding
 * refund-signal-nsfw.md rule 3, ADR-0002). The status rule already transitioned
 * the event to `refunded { amount: cost }`; the wallet `subscription_balance`
 * returns to its pre-charge level by the same `cost` a few seconds later. This
 * reconciles the observed wallet delta (from the retained `raw_captures`) against
 * that recorded amount — matched to the event by `toolRef` — WITHOUT trusting the
 * status alone.
 *
 * A read, not a write: it never overwrites the refunded amount with whatever the
 * wallet showed (that would be guessing). Agreement is `confirmed`; a
 * disagreement is a `mismatch` carrying the evidence, to be recorded as a Flagged
 * anomaly (issue #8). When the status rule has not yet recorded a refund, the
 * recorded amount is 0, so a real wallet refund surfaces as a mismatch rather
 * than being silently accepted.
 *
 * Scoped to one Organization (AGENTS.md §6 — every query filters by
 * `organizationId`; ADR-0004 strict single-org isolation): the lookup takes the
 * caller's org and resolves the event through `by_org_tool_ref`, so a caller can
 * never reach another tenant's event and a `toolRef` that collides across orgs
 * stays isolated (a bare `by_tool_ref` `.unique()` would throw on the collision).
 *
 * NOT YET WIRED IN PRODUCTION (issue #8). Nothing calls this today: the
 * extension neither extracts the wallet `subscription_balance` from
 * `/fnf/workspaces/wallet` nor invokes this query, and there is no anomaly sink
 * for a `mismatch`. Full production wiring — extract the wallet balance delta →
 * call this cross-check → record a `mismatch` as a Flagged anomaly — lands with
 * the flagged-anomaly recording of issue #8. Kept in place (and org-scoped) now
 * so #8 wires an already-correct query rather than a leaky one.
 * TODO(#8): wire wallet-delta extraction + mismatch recording; this query is the
 * seam it plugs into.
 */
export const crossCheckWalletRefund = query({
  args: { organizationId: v.string(), toolRef: v.string(), walletDelta: v.number() },
  handler: async (
    ctx,
    { organizationId, toolRef, walletDelta },
  ): Promise<
    { kind: 'no-event' } | { kind: 'confirmed' } | { kind: 'mismatch'; mismatch: RefundMismatch }
  > => {
    const event = await ctx.db
      .query('events')
      .withIndex('by_org_tool_ref', (q) =>
        q.eq('organizationId', organizationId).eq('toolRef', toolRef),
      )
      .unique();
    if (!event) return { kind: 'no-event' };
    const recorded = event.refund.kind === 'refunded' ? event.refund.amount : 0;
    const mismatch = crossCheckRefund(recorded, walletDelta);
    return mismatch === null ? { kind: 'confirmed' } : { kind: 'mismatch', mismatch };
  },
});

/**
 * Net usage (charges minus refunds) for one Asset within an Organization,
 * plus the underlying events so callers can reconcile the total.
 *
 * Every roll-up filters by `organizationId` (ADR-0004). `'unattributed'` is a
 * reserved sentinel, not an Asset (CONTEXT.md / `@token-tracker/shared`): a
 * charge with no Active Asset rolls up to its Brand and Organization but to no
 * Asset. Passing it here is rejected so it can never surface as an Asset total
 * (issue #6, criteria 2 & 3).
 */
export const usageByAsset = query({
  args: { organizationId: v.string(), assetId: v.string() },
  handler: async (ctx, { organizationId, assetId }) => {
    if (assetId === 'unattributed') {
      throw new Error(
        "'unattributed' is not an Asset; query its usage at the Brand or Organization level instead.",
      );
    }
    const events = await ctx.db
      .query('events')
      .withIndex('by_org_asset', (q) =>
        q.eq('organizationId', organizationId).eq('assetId', assetId),
      )
      .collect();
    return { organizationId, assetId, net: sumNet(events), events };
  },
});

/** Net usage for one Brand within an Organization (includes unattributed events). */
export const usageByBrand = query({
  args: { organizationId: v.string(), brandId: v.string() },
  handler: async (ctx, { organizationId, brandId }) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_org_brand', (q) =>
        q.eq('organizationId', organizationId).eq('brandId', brandId),
      )
      .collect();
    return { organizationId, brandId, net: sumNet(events), events };
  },
});

/** Net usage for an entire Organization (every event it owns). */
export const usageByOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
      .collect();
    return { organizationId, net: sumNet(events), events };
  },
});

/** Net usage for one User within an Organization — the independent per-editor axis. */
export const usageByUser = query({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId).eq('userId', userId))
      .collect();
    return { organizationId, userId, net: sumNet(events), events };
  },
});

// --- Generation Gallery views (issue #7) --------------------------------------
// Read-only projections (prompt + Result media + Cost) for the dashboard gallery,
// ordered newest-first. Every view is org-scoped (ADR-0004). The projection
// itself is the pure `toGenerationView` (see `gallery.ts`).

/** One editor's generations within an Organization — the gallery's per-Editor feed. */
export const generationsByUser = query({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_org_user', (q) => q.eq('organizationId', organizationId).eq('userId', userId))
      .order('desc')
      .collect();
    return events.map(toGenerationView);
  },
});

/**
 * Live tracking indicator (issue #18): the current editor's most-recent
 * generations within their Organization, newest-first, each carrying the derived
 * lifecycle status (tracked → generating → generated / refunded / flagged) the
 * popup row renders. The reactive read surface behind the popup's `useQuery`, so
 * rows update in real time as status polls and refunds land — no manual refresh.
 *
 * Org- AND user-scoped (AGENTS.md §6, ADR-0004): read through `by_org_user` so an
 * editor only ever sees their own generations, never another editor's or another
 * tenant's. `.take(limit)` bounds the payload to recent activity rather than the
 * editor's whole history — this is a live indicator, not the gallery.
 *
 * The `flagged` status needs the org's Flagged anomalies (#8): they live in a
 * separate table and link back to a generation by its job-set `toolRef`. For each
 * shown event we look its anomalies up EXACTLY through the `by_org_tool_ref` index
 * — bounded per event and never dropping a still-relevant anomaly past a scan
 * window — then mark the row via the shared `isEventFlagged`/`lifecycleStatus`
 * (AGENTS.md §6, one source of truth). A raw `click-no-request` anomaly references
 * no generation (it has no `toolRef`), so it never flags a row.
 *
 * `unknown-status` anomalies carry only a `jobId` in their `evidence` and no
 * top-level `toolRef`, so they are not reachable by this index and don't flag a row
 * yet. That is a deliberate, documented gap (rare now that `nsfw`/`failed` are
 * known statuses): closing it means denormalising the offending job's set-`toolRef`
 * onto the anomaly row at record time, which touches #8's write path — a follow-up,
 * not this display ticket. The shared matcher already handles the jobId case for
 * when that lands.
 */
export const recentGenerations = query({
  args: { organizationId: v.string(), userId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { organizationId, userId, limit }) => {
    const events = await ctx.db
      .query('events')
      // Order by CAPTURE time, not row-creation time: the background records events
      // fire-and-forget, so inserts can land out of capture order and a plain
      // `by_org_user` scan would return the wrong "most recent" set (#18).
      .withIndex('by_org_user_captured', (q) =>
        q.eq('organizationId', organizationId).eq('userId', userId),
      )
      .order('desc')
      // Default to a small window — the indicator shows *recent* activity, not the
      // full feed (that is the gallery's `generationsByUser`).
      .take(limit ?? 20);

    // Resolve each shown event's `flagged` status by an EXACT, org-scoped reverse
    // lookup on its `toolRef` (ADR-0004 — same tenant only): fetch just the
    // anomalies that reference these events, not the org's whole anomaly history.
    // De-duplicate `toolRef`s so repeated ids cost one lookup.
    const toolRefs = [
      ...new Set(
        events
          .map((event) => event.toolRef)
          .filter((toolRef): toolRef is string => toolRef !== undefined),
      ),
    ];
    const anomalyGroups = await Promise.all(
      toolRefs.map((toolRef) =>
        ctx.db
          .query('flagged_anomalies')
          .withIndex('by_org_tool_ref', (q) =>
            q.eq('organizationId', organizationId).eq('toolRef', toolRef),
          )
          .collect(),
      ),
    );
    const refs = collectAnomalyRefs(anomalyGroups.flat());

    return events.map((event) => toRecentGeneration(event, isEventFlagged(event, refs)));
  },
});

/**
 * One Asset's generations within an Organization — the gallery's per-Asset browse
 * view. `'unattributed'` is the sentinel, not an Asset (CONTEXT.md); it is refused
 * here for the same reason `usageByAsset` refuses it — query the intake tray
 * (`unattributedGenerations`) for those instead.
 */
export const generationsByAsset = query({
  args: { organizationId: v.string(), assetId: v.string() },
  handler: async (ctx, { organizationId, assetId }) => {
    if (assetId === 'unattributed') {
      throw new Error(
        "'unattributed' is not an Asset; list its generations via unattributedGenerations instead.",
      );
    }
    const events = await ctx.db
      .query('events')
      .withIndex('by_org_asset', (q) =>
        q.eq('organizationId', organizationId).eq('assetId', assetId),
      )
      .order('desc')
      .collect();
    return events.map(toGenerationView);
  },
});

/**
 * One editor's intake tray: their Unattributed Generation events awaiting
 * Assignment (`assetId === 'unattributed'`, `assignment.status === 'needs-assignment'`),
 * newest-first. Drives the gallery's keyboard-first triage backlog; `assignAsset`
 * clears items from it one accession at a time.
 *
 * Scoped by BOTH `organizationId` and `userId` (AGENTS.md §6, ADR-0004), matching
 * the per-editor semantics of the feed (`generationsByUser`): the gallery is one
 * editor's surface, so an editor only ever sees — and can only ever assign —
 * their own unattributed work, never another editor's. Read through the
 * `by_org_user_asset` index narrowed to the `'unattributed'` sentinel, so it never
 * scans another editor's work or the org's attributed events.
 */
export const unattributedGenerations = query({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_org_user_asset', (q) =>
        q.eq('organizationId', organizationId).eq('userId', userId).eq('assetId', 'unattributed'),
      )
      .order('desc')
      .collect();
    return events.map(toGenerationView);
  },
});
