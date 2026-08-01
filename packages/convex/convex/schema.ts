import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Convex schema. Mirrors the GenerationEvent shape in @token-tracker/shared
 * (AGENTS.md §6). Keep the two in sync.
 */

const refundState = v.union(
  v.object({ kind: v.literal('none') }),
  v.object({ kind: v.literal('pending') }),
  v.object({ kind: v.literal('refunded'), amount: v.number(), at: v.number() }),
);

export default defineSchema({
  events: defineTable({
    userId: v.string(),
    tool: v.union(v.literal('flow'), v.literal('higgsfield'), v.literal('kling')),
    brandId: v.string(),
    assetId: v.string(),
    cost: v.number(),
    refund: refundState,
    capturedAt: v.number(),
    toolRef: v.optional(v.string()),
  })
    // Roll-up query paths: event -> asset -> brand, and event -> user.
    .index('by_asset', ['assetId'])
    .index('by_brand', ['brandId'])
    .index('by_user', ['userId'])
    .index('by_tool_ref', ['toolRef']),
});
