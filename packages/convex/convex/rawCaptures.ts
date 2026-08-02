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
 * How recent the retained prior capture must be for a byte-identical repeat to be
 * dropped as a duplicate (finding: de-dup must not drop recent traffic). De-dup
 * exists to collapse a burst of status polls, which land seconds-to-minutes apart
 * within one job's lifetime, so a 1-day window covers any real poll span while
 * sitting far below the 30-day TTL. The point: because `record` is insert-only
 * (ADR-0001 — rows are never patched, so we cannot refresh a retained row's
 * timestamp), collapsing a fresh observation onto a copy that is itself near the
 * TTL would let the prune delete the copy and lose the observation entirely. With
 * the window ≪ TTL, any row we de-dup against still has ~29 days of life left, so
 * a fresh observation is never dropped in favour of an about-to-expire one.
 */
const RAW_CAPTURE_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Upper bound on rows read+deleted per prune transaction. Each `raw_captures` row
 * carries verbatim request/response bodies and can approach Convex's 1 MiB
 * per-document limit, and `pruneOld` reads whole documents (Convex has no
 * projection — `.take(n)` reads full rows). At 8 rows that is ≈ 8 MiB worst case,
 * half of Convex's 16 MiB per-transaction *read* limit — so a batch of large rows
 * can never trip that limit and wedge the cron. A backlog larger than one batch is
 * drained by rescheduling (below), not by one unbounded read.
 */
const PRUNE_BATCH = 8;

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
    // Only de-dup against a *sufficiently recent* copy. If the retained row is
    // older than the de-dup window it may be near the TTL and about to be pruned;
    // collapsing today's observation onto it would then lose the observation
    // outright (record is insert-only, so we can't refresh the old row's clock).
    // A repeat older than the window is treated as fresh and retained.
    if (
      previous &&
      args.capturedAt - previous.capturedAt <= RAW_CAPTURE_DEDUP_WINDOW_MS &&
      isDuplicateCapture(previous, args)
    ) {
      return null;
    }

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
 * defaults. Reads+deletes at most `PRUNE_BATCH` full rows per call and reschedules
 * itself when a full batch is drained, so a large backlog of big-bodied rows never
 * exceeds Convex's 16 MiB per-transaction read limit (which would wedge the cron).
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
