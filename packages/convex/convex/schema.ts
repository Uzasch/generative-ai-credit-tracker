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

export default defineSchema({
  events: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    tool: v.union(v.literal('flow'), v.literal('higgsfield'), v.literal('kling')),
    brandId: v.string(),
    // `'unattributed'` sentinel allowed; validated as a plain string.
    assetId: v.string(),
    prompt: v.optional(v.string()),
    cost: v.number(),
    jobs: v.array(jobOutcome),
    refund: refundState,
    capturedAt: v.number(),
    toolRef: v.optional(v.string()),
    toolAccount: v.optional(v.string()),
    ruleVersion: v.number(),
  })
    // Roll-up query paths: event -> asset -> brand, and event -> user.
    .index('by_asset', ['assetId'])
    .index('by_brand', ['brandId'])
    .index('by_user', ['userId'])
    .index('by_org', ['organizationId'])
    .index('by_org_brand', ['organizationId', 'brandId'])
    .index('by_tool_ref', ['toolRef']),
});
