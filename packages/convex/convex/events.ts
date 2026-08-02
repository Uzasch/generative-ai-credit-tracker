import type { JobStatus } from '@token-tracker/shared';
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
);

const jobOutcome = v.object({
  jobId: v.string(),
  status: jobStatus,
  mediaUrl: v.optional(v.string()),
});

/**
 * How far a job has progressed, for ordering out-of-order status polls. Passive
 * polls can arrive late; a job never moves backwards and, once terminal, never
 * changes again. `completed` and `failed` share the terminal rank.
 */
const STATUS_RANK: Record<JobStatus, number> = {
  queued: 0,
  in_progress: 1,
  completed: 2,
  failed: 2,
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
  },
  handler: async (ctx, { organizationId, jobId, status, mediaUrl }) => {
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
      await ctx.db.patch(event._id, { jobs });
      return event._id;
    }
    return null;
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
