import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { sumNet } from './rollups';

const refundState = v.union(
  v.object({ kind: v.literal('none') }),
  v.object({ kind: v.literal('pending') }),
  v.object({ kind: v.literal('refunded'), amount: v.number(), at: v.number() }),
);

const jobOutcome = v.object({
  jobId: v.string(),
  status: v.union(
    v.literal('queued'),
    v.literal('in_progress'),
    v.literal('completed'),
    v.literal('failed'),
  ),
  mediaUrl: v.optional(v.string()),
});

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
    capturedAt: v.number(),
    toolRef: v.optional(v.string()),
    toolAccount: v.optional(v.string()),
    ruleVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const { refund, jobs, ...rest } = args;
    return await ctx.db.insert('events', {
      ...rest,
      jobs: jobs ?? [],
      refund: refund ?? { kind: 'none' },
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
