import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

// convex-test loads every function module in this directory in-memory.
const modules = import.meta.glob('./**/*.*s');

const HOST = 'https://fnf-api-gw.higgsfield.ai';

// Derived from the canonical `record` validator so the test can't drift from the
// capture shape (AGENTS.md §2 — never re-declare cross-cutting types).
type CaptureInput = FunctionArgs<typeof api.rawCaptures.record>;

/** A single in-progress status poll; override only what a test cares about. */
function capture(overrides: Partial<CaptureInput> = {}): CaptureInput {
  return {
    method: 'GET',
    url: `${HOST}/fnf/jobs/job_abc`,
    status: 200,
    requestBody: null,
    responseBody: '{"id":"job_abc","status":"in_progress"}',
    capturedAt: 1,
    ...overrides,
  };
}

test('denylisted UI-chatter endpoints are not stored', async () => {
  const t = convexTest(schema, modules);
  const id = await t.mutation(
    api.rawCaptures.record,
    capture({ url: `${HOST}/fnf/folders/accessible` }),
  );
  expect(id).toBeNull();
  const rows = await t.query(api.rawCaptures.recent, {});
  expect(rows).toHaveLength(0);
});

test('generation and wallet traffic are still stored', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.rawCaptures.record, capture({ url: `${HOST}/fnf/jobs/job_abc` }));
  await t.mutation(api.rawCaptures.record, capture({ url: `${HOST}/fnf/workspaces/wallet` }));
  const rows = await t.query(api.rawCaptures.recent, {});
  expect(rows).toHaveLength(2);
});

test('an identical consecutive status poll is collapsed, a transition is kept', async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(api.rawCaptures.record, capture({ capturedAt: 1 }));
  expect(first).not.toBeNull();
  // Same body again — no new information, dropped.
  const dup = await t.mutation(api.rawCaptures.record, capture({ capturedAt: 2 }));
  expect(dup).toBeNull();
  // Status transitions — retained so the transition is fully captured.
  const transition = await t.mutation(
    api.rawCaptures.record,
    capture({ capturedAt: 3, responseBody: '{"id":"job_abc","status":"completed"}' }),
  );
  expect(transition).not.toBeNull();

  const rows = await t.query(api.rawCaptures.recent, {});
  expect(rows).toHaveLength(2);
});

test('a fresh repeat identical to an about-to-expire copy is retained, not dropped', async () => {
  const t = convexTest(schema, modules);
  const url = `${HOST}/fnf/jobs/status-batch`;
  const day = 24 * 60 * 60 * 1000;
  // First observation — imagine it captured long ago, near the TTL horizon.
  const first = await t.mutation(
    api.rawCaptures.record,
    capture({ url, method: 'POST', requestBody: '{"ids":["a"]}', capturedAt: 1 }),
  );
  expect(first).not.toBeNull();
  // Byte-identical, but observed two days later — older than the de-dup window,
  // so the retained copy may be pruned before this fresh observation. It must be
  // kept, not collapsed onto an about-to-expire row (finding: de-dup drops recent
  // traffic). Under the old "de-dup vs the latest row regardless of age" this
  // returned null and the observation was lost.
  const laterFresh = await t.mutation(
    api.rawCaptures.record,
    capture({ url, method: 'POST', requestBody: '{"ids":["a"]}', capturedAt: 1 + 2 * day }),
  );
  expect(laterFresh).not.toBeNull();
  // A second identical poll moments after the fresh row IS within the window —
  // still collapsed, so ordinary burst-polling de-dup is unaffected.
  const immediateDup = await t.mutation(
    api.rawCaptures.record,
    capture({ url, method: 'POST', requestBody: '{"ids":["a"]}', capturedAt: 1 + 2 * day + 1000 }),
  );
  expect(immediateDup).toBeNull();

  const rows = await t.query(api.rawCaptures.recent, {});
  expect(rows).toHaveLength(2);
});

test('prune drains a backlog of large rows without exceeding the 16 MiB read limit', async () => {
  // Enforce Convex's real per-transaction limits (16 MiB read) so this test fails
  // if a single prune reads too many full-bodied rows at once.
  const t = convexTest({ schema, modules, transactionLimits: true });
  const now = 2_000_000_000_000;
  const ttlMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff = now - ttlMs;

  // 40 expired rows, each ~512 KiB of body ⇒ ~20 MiB total, over the 16 MiB
  // read limit. Pre-fix (`PRUNE_BATCH = 256`) a single prune reads all 40 in one
  // transaction and throws "Read too much data", wedging the cron forever. Seeded
  // one row per transaction so seeding itself stays under the write limit.
  const bigBody = 'x'.repeat(512 * 1024);
  const EXPIRED = 40;
  for (let i = 0; i < EXPIRED; i++) {
    await t.run(async (ctx) => {
      await ctx.db.insert('raw_captures', {
        method: 'GET',
        url: `${HOST}/fnf/jobs/expired_${i}`,
        status: 200,
        requestBody: null,
        responseBody: bigBody,
        capturedAt: cutoff - 1,
      });
    });
  }

  vi.useFakeTimers();
  try {
    // Must not throw (a bounded batch stays well under the read limit) and must
    // delete strictly fewer than the whole backlog — proof it batched rather than
    // reading everything at once.
    const firstPrune = await t.mutation(internal.rawCaptures.pruneOld, { now, ttlMs });
    expect(firstPrune.deleted).toBeGreaterThan(0);
    expect(firstPrune.deleted).toBeLessThan(EXPIRED);

    // Drain the rescheduled continuations; the whole backlog is gone.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.query(api.rawCaptures.recent, {});
    expect(rows).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('retention prune removes rows older than the TTL and keeps recent ones', async () => {
  const t = convexTest(schema, modules);
  const now = 1_000_000_000;
  const ttlMs = 30 * 24 * 60 * 60 * 1000;
  // One row well past the TTL, one just inside it. Distinct URLs so neither is
  // collapsed as a duplicate poll.
  await t.mutation(
    api.rawCaptures.record,
    capture({ url: `${HOST}/fnf/jobs/old`, capturedAt: now - ttlMs - 1 }),
  );
  await t.mutation(
    api.rawCaptures.record,
    capture({ url: `${HOST}/fnf/jobs/fresh`, capturedAt: now - 1 }),
  );

  const result = await t.mutation(internal.rawCaptures.pruneOld, { now, ttlMs });
  expect(result.deleted).toBe(1);

  const rows = await t.query(api.rawCaptures.recent, {});
  expect(rows).toHaveLength(1);
  expect(rows[0]?.url).toBe(`${HOST}/fnf/jobs/fresh`);
});
