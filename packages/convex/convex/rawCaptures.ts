import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Append a single raw capture from the extension's MAIN-world fetch probe.
 * Insert-only: the `raw_captures` table is append-only (ADR-0001), so this
 * function never patches or deletes. Bodies are stored verbatim as captured;
 * request headers are dropped in the probe and never reach here.
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
  handler: async (ctx, args) => {
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
