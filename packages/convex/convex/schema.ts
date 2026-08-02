import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Convex schema. Mirrors the GenerationEvent shape in @token-tracker/shared
 * (AGENTS.md §6). Keep the two in sync.
 */

const refundState = v.union(
  v.object({ kind: v.literal('none') }),
  v.object({ kind: v.literal('pending') }),
  // `amount` is a client-influenced magnitude (it originates in captured tool
  // traffic and nets directly out of Asset/Brand/Org usage). Convex field
  // validators are structural and cannot reject NaN/Infinity/negative, so every
  // mutation that writes a refund guards it at the write boundary with
  // `assertRefundAmount` (@token-tracker/shared) before it reaches this table —
  // a negative amount would *inflate* net usage rather than net it out.
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
   * Phase-1 discovery probe (ADR-0001): retained raw traffic from
   * `fnf-api-gw.higgsfield.ai`. Rows are never modified after insert — refunds
   * and batch cost are discovered here later, and every derived number stays
   * replayable (ADR-0003). Headers are never captured, so no auth token lands
   * here. Growth is bounded (ADR-0007), not by mutating rows but by not writing
   * noise (denylist) or duplicate status polls, plus a retention-TTL prune.
   */
  raw_captures: defineTable({
    method: v.string(),
    url: v.string(),
    requestBody: v.union(v.string(), v.null()),
    responseBody: v.union(v.string(), v.null()),
    status: v.number(),
    capturedAt: v.number(),
  })
    // Retention prune ranges over the oldest rows (ADR-0007 TTL).
    .index('by_captured_at', ['capturedAt'])
    // De-dup looks up the most recent prior capture for the same URL to collapse
    // identical consecutive status polls (ADR-0007). `capturedAt` orders the
    // per-URL history so the latest is a single `.order('desc').first()`.
    .index('by_url', ['url', 'capturedAt']),

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
    // The gallery's per-editor intake tray: one editor's unattributed events.
    // Scoped by org + user (the gallery is a single editor's surface, ADR-0004)
    // and narrowed to the `'unattributed'` sentinel, so it never scans another
    // editor's work or the org's attributed events.
    .index('by_org_user_asset', ['organizationId', 'userId', 'assetId'])
    // Refund reconciliation looks an event up by its tool-side job-set id.
    .index('by_tool_ref', ['toolRef'])
    // Org-scoped tool-ref lookup: every query filters by `organizationId`
    // (AGENTS.md §6, ADR-0004), so a cross-check can never resolve another
    // tenant's event, and duplicate `toolRef`s across orgs stay isolated
    // (a bare `by_tool_ref` `.unique()` would throw on the collision).
    .index('by_org_tool_ref', ['organizationId', 'toolRef']),
});
