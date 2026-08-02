import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { expect, test } from 'vitest';
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
