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

const assignmentState = v.union(
  v.object({ status: v.literal('assigned') }),
  v.object({ status: v.literal('needs-assignment') }),
);

const jobOutcome = v.object({
  jobId: v.string(),
  status: v.union(
    v.literal('queued'),
    v.literal('in_progress'),
    v.literal('completed'),
    v.literal('failed'),
    // Content-safety rejection; a non-`completed` terminal failure (mirrors
    // JOB_STATUSES / FAILURE_STATUSES in @token-tracker/shared).
    v.literal('nsfw'),
  ),
  mediaUrl: v.optional(v.string()),
});

export default defineSchema({
  /**
   * Phase-1 discovery probe (ADR-0001): append-only, retained raw traffic from
   * `fnf-api-gw.higgsfield.ai`. Never modified after insert — refunds and batch
   * cost are discovered here later, and every derived number stays replayable
   * (ADR-0003). Headers are never captured, so no auth token lands here.
   */
  raw_captures: defineTable({
    method: v.string(),
    url: v.string(),
    requestBody: v.union(v.string(), v.null()),
    responseBody: v.union(v.string(), v.null()),
    status: v.number(),
    capturedAt: v.number(),
  }).index('by_captured_at', ['capturedAt']),

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
    // 'needs-assignment' mirrors the `'unattributed'` assetId sentinel; an editor
    // resolves it to 'assigned' via Assignment (CONTEXT.md).
    assignment: assignmentState,
    capturedAt: v.number(),
    toolRef: v.optional(v.string()),
    toolAccount: v.optional(v.string()),
    ruleVersion: v.number(),
  })
    // Roll-up query paths. Every roll-up is scoped to one Organization
    // (ADR-0004, single-org isolation), so each index leads with
    // `organizationId`: event -> org, org -> brand, org -> asset, and
    // independently org -> user.
    .index('by_org', ['organizationId'])
    .index('by_org_brand', ['organizationId', 'brandId'])
    .index('by_org_asset', ['organizationId', 'assetId'])
    .index('by_org_user', ['organizationId', 'userId'])
    // Refund reconciliation looks an event up by its tool-side job-set id.
    .index('by_tool_ref', ['toolRef']),
});
