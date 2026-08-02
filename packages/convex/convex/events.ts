import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

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

/** Net cost (charges minus refunds) for one asset, plus its raw events. */
export const usageByAsset = query({
  args: { assetId: v.string() },
  handler: async (ctx, { assetId }) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_asset', (q) => q.eq('assetId', assetId))
      .collect();
    const net = events.reduce((sum, e) => {
      const refunded = e.refund.kind === 'refunded' ? e.refund.amount : 0;
      return sum + e.cost - refunded;
    }, 0);
    return { assetId, net, events };
  },
});
