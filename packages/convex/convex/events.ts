import {
  type JobStatus,
  type RefundMismatch,
  assertRefundAmount,
  crossCheckRefund,
  isFailureStatus,
  refundForStatus,
} from '@token-tracker/shared';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
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
      const refund =
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
 */
export const crossCheckWalletRefund = query({
  args: { toolRef: v.string(), walletDelta: v.number() },
  handler: async (
    ctx,
    { toolRef, walletDelta },
  ): Promise<
    { kind: 'no-event' } | { kind: 'confirmed' } | { kind: 'mismatch'; mismatch: RefundMismatch }
  > => {
    const event = await ctx.db
      .query('events')
      .withIndex('by_tool_ref', (q) => q.eq('toolRef', toolRef))
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
