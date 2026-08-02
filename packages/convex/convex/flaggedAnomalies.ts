import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Flagged anomalies (ADR-0002, CONTEXT.md "Flagged anomaly"). When the
 * deterministic runtime cannot confidently classify a generation-related
 * observation, it records the raw evidence here instead of guessing an outcome.
 * These rows are the input to the offline Discovery agent (ADR-0003); they are
 * never billed and never net into usage.
 *
 * Two triggers write here today (#8): the click tripwire's `click-no-request`
 * (a Generate click with no matching generate request in the window) and the
 * status path's `unknown-status` (a Job status outside the shared JobStatus
 * union). The button cost-mismatch (#13) will emit into this same table by
 * adding a union arm to `anomalyEvidence` — this module needs no change for it.
 */

/**
 * Raw evidence per trigger, mirrors `AnomalyEvidence`/schema.ts. Discriminated on
 * `kind`. #13 adds the `cost-mismatch` arm in all three places (kept in sync).
 */
const anomalyEvidence = v.union(
  v.object({
    kind: v.literal('click-no-request'),
    host: v.string(),
    clickedAt: v.number(),
    windowMs: v.number(),
  }),
  v.object({
    kind: v.literal('unknown-status'),
    jobId: v.string(),
    rawStatus: v.string(),
    sourceUrl: v.string(),
  }),
);

/**
 * Record one flagged anomaly. Kind-agnostic: it persists whatever evidence arm
 * the caller raised, so a new trigger (e.g. #13's cost-mismatch) needs only a new
 * union arm, not a new mutation. Org-scoped by the `organizationId` on the row
 * (AGENTS.md §6, ADR-0004). Insert-only — evidence is never mutated after the
 * fact, so it stays a faithful record for the Discovery agent.
 */
export const record = mutation({
  args: {
    organizationId: v.string(),
    tool: v.union(v.literal('flow'), v.literal('higgsfield'), v.literal('kling')),
    toolRef: v.optional(v.string()),
    observedAt: v.number(),
    evidence: anomalyEvidence,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('flagged_anomalies', args);
  },
});

/**
 * List one Organization's flagged anomalies, newest-first by observation time.
 * Org-scoped through the `by_org_observed_at` index (AGENTS.md §6, ADR-0004): a
 * caller passing their own org can never read another tenant's anomalies. Ordering
 * on that index keys the "newest-first" contract off `observedAt` rather than
 * Convex row-creation time (which fire-and-forget writes can reorder). This is the
 * read surface the Discovery agent's export path (ADR-0003) and any in-app review
 * will build on.
 */
export const listByOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    return await ctx.db
      .query('flagged_anomalies')
      .withIndex('by_org_observed_at', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .collect();
  },
});
