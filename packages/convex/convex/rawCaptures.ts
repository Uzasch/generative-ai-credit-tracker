import { isDenylistedCaptureUrl, isDuplicateCapture } from '@token-tracker/shared';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';

/**
 * How long a raw capture is retained before the prune cron removes it (ADR-0007).
 * The probe's value is *recent*-traffic discovery, so 30 days keeps plenty of
 * window while bounding the table. Single knob — change it here.
 */
const RAW_CAPTURE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Upper bound on rows deleted per prune transaction. A backlog larger than this
 * is drained by rescheduling (below) rather than by one unbounded mutation, so a
 * prune can never exceed Convex's per-transaction write limits.
 */
const PRUNE_BATCH = 256;

/**
 * Append a single raw capture from the extension's MAIN-world fetch probe.
 *
 * The `raw_captures` table is never patched or deleted in place (ADR-0001) — this
 * mutation only ever inserts. It bounds the table at the single write boundary
 * (ADR-0007) by declining to insert traffic that carries nothing the tracker
 * uses: denylisted UI-chatter endpoints, and status polls byte-identical to the
 * previous capture for the same URL. Both decisions are the pure, shared rules in
 * `@token-tracker/shared`, so they stay checkable and testable. Returns the new
 * row id, or `null` when the capture was intentionally not retained.
 *
 * Bodies are stored verbatim as captured; request headers are dropped in the
 * probe and never reach here.
 */
export const record = mutation({
  args: {
    method: v.string(),
    url: v.string(),
    requestBody: v.union(v.string(), v.null()),
    responseBody: v.union(v.string(), v.null()),
    status: v.number(),
    capturedAt: v.number(),
  },
  handler: async (ctx, args): Promise<Id<'raw_captures'> | null> => {
    // Known non-generation noise — never retained (ADR-0007 denylist).
    if (isDenylistedCaptureUrl(args.url)) return null;

    // Collapse an identical consecutive status poll: the tool re-polls the same
    // URL until a job transitions, so only a body change is new information
    // (ADR-0007). Compared against the most recent prior capture for this URL.
    const previous = await ctx.db
      .query('raw_captures')
      .withIndex('by_url', (q) => q.eq('url', args.url))
      .order('desc')
      .first();
    if (previous && isDuplicateCapture(previous, args)) return null;

    return await ctx.db.insert('raw_captures', args);
  },
});

/** Most-recent captures first — for eyeballing what the probe is retaining. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query('raw_captures')
      .withIndex('by_captured_at')
      .order('desc')
      .take(limit ?? 50);
  },
});

/**
 * Retention-TTL prune (ADR-0007): delete raw captures older than the TTL. Run on
 * a cron (see `crons.ts`); internal so no client can trigger or parametrise it.
 * `now`/`ttlMs` are injectable for deterministic tests; production uses the
 * defaults. Deletes at most `PRUNE_BATCH` per call and reschedules itself when a
 * full batch is drained, so a large backlog never exceeds the write limit.
 */
export const pruneOld = internalMutation({
  args: { now: v.optional(v.number()), ttlMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    const now = args.now ?? Date.now();
    const ttlMs = args.ttlMs ?? RAW_CAPTURE_TTL_MS;
    const cutoff = now - ttlMs;

    const expired = await ctx.db
      .query('raw_captures')
      .withIndex('by_captured_at', (q) => q.lt('capturedAt', cutoff))
      .take(PRUNE_BATCH);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }

    // A full batch means more may remain; continue on a fresh transaction.
    if (expired.length === PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.rawCaptures.pruneOld, { now, ttlMs });
    }
    return { deleted: expired.length };
  },
});
