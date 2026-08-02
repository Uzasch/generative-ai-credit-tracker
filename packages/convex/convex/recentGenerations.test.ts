import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// convex-test loads every function module in this directory in-memory.
const modules = import.meta.glob('./**/*.*s');

const ORG = 'org_studio';
const USER = 'user_a';

// Derived from the canonical validators so these tests can't drift from the
// event / anomaly shapes (AGENTS.md §2 — never re-declare cross-cutting types).
type EventInput = FunctionArgs<typeof api.events.record>;

/** A fully-attributed Higgsfield event; override only what a test cares about. */
function eventArgs(overrides: Partial<EventInput> = {}): EventInput {
  return {
    organizationId: ORG,
    userId: USER,
    tool: 'higgsfield',
    brandId: 'brand_x',
    assetId: 'asset_1',
    cost: 100,
    capturedAt: 1,
    ruleVersion: 1,
    ...overrides,
  };
}

test('recentGenerations derives tracked / generating / generated per row', async () => {
  const t = convexTest(schema, modules);
  // Recorded charge, no jobs yet → tracked.
  await t.mutation(api.events.record, eventArgs({ toolRef: 'set_tracked', capturedAt: 1 }));
  // A job still in flight → generating.
  await t.mutation(
    api.events.record,
    eventArgs({
      toolRef: 'set_generating',
      capturedAt: 2,
      jobs: [{ jobId: 'j_gen', status: 'in_progress' }],
    }),
  );
  // Every job terminal, no failure → generated.
  await t.mutation(
    api.events.record,
    eventArgs({
      toolRef: 'set_generated',
      capturedAt: 3,
      jobs: [{ jobId: 'j_done', status: 'completed', mediaUrl: 'https://cdn/x.png' }],
    }),
  );

  const rows = await t.query(api.events.recentGenerations, {
    organizationId: ORG,
    userId: USER,
  });

  // Newest-first ordering (capturedAt desc via by_org_user index).
  expect(rows.map((r) => r.status)).toEqual(['generated', 'generating', 'tracked']);
  const generated = rows.find((r) => r.status === 'generated');
  expect(generated?.jobCount).toBe(1);
  expect(generated?.completedCount).toBe(1);
});

test('a job reaching a failure terminal shows as refunded (net 0), reactively', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({
      toolRef: 'set_refund',
      cost: 1200,
      jobs: [{ jobId: 'j_nsfw', status: 'in_progress' }],
    }),
  );

  // Before the terminal poll it is still generating.
  let rows = await t.query(api.events.recentGenerations, { organizationId: ORG, userId: USER });
  expect(rows[0]?.status).toBe('generating');

  // The tool's own status poll reports the nsfw terminal → full refund (#17).
  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'j_nsfw',
    status: 'nsfw',
    at: 99,
  });

  rows = await t.query(api.events.recentGenerations, { organizationId: ORG, userId: USER });
  expect(rows[0]?.status).toBe('refunded');
  // The credited-back amount is carried so the row can show net 0.
  expect(rows[0]?.refund).toEqual({ kind: 'refunded', amount: 1200, at: 99 });
});

test('a cost-mismatch anomaly flags its event by toolRef; flagged outranks the outcome', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({
      toolRef: 'set_flagged',
      jobs: [{ jobId: 'j_ok', status: 'completed', mediaUrl: 'https://cdn/x.png' }],
    }),
  );

  // Without the anomaly the completed generation reads as generated.
  let rows = await t.query(api.events.recentGenerations, { organizationId: ORG, userId: USER });
  expect(rows[0]?.status).toBe('generated');

  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: ORG,
    tool: 'higgsfield',
    toolRef: 'set_flagged',
    observedAt: 10,
    evidence: { kind: 'cost-mismatch', displayedCost: 12, responseCost: 1200, expectedCost: 1200 },
  });

  rows = await t.query(api.events.recentGenerations, { organizationId: ORG, userId: USER });
  expect(rows[0]?.status).toBe('flagged');
});

test('an unknown-status anomaly with no toolRef does not flag the row yet (documented gap)', async () => {
  // `unknown-status` carries only a jobId in its evidence and no top-level toolRef,
  // so the exact `by_org_tool_ref` reverse lookup can't reach it. Closing this gap
  // means denormalising the job's set-toolRef onto the anomaly row at record time
  // (touches #8's write path) — a follow-up, not this display ticket.
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({
      toolRef: 'set_unknown',
      jobs: [{ jobId: 'j_weird', status: 'in_progress' }],
    }),
  );
  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: ORG,
    tool: 'higgsfield',
    observedAt: 10,
    evidence: {
      kind: 'unknown-status',
      jobId: 'j_weird',
      rawStatus: 'exploded',
      sourceUrl: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/status-batch',
    },
  });

  const rows = await t.query(api.events.recentGenerations, { organizationId: ORG, userId: USER });
  expect(rows[0]?.status).toBe('generating');
});

test('is scoped to the current editor and org — never another editor or tenant', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ userId: USER, toolRef: 'mine' }));
  await t.mutation(api.events.record, eventArgs({ userId: 'user_b', toolRef: 'peer' }));
  await t.mutation(
    api.events.record,
    eventArgs({ organizationId: 'org_rival', userId: USER, toolRef: 'rival' }),
  );

  const rows = await t.query(api.events.recentGenerations, { organizationId: ORG, userId: USER });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.id).toBeDefined();

  // An anomaly in another org must never flag this editor's rows.
  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: 'org_rival',
    tool: 'higgsfield',
    toolRef: 'mine',
    observedAt: 10,
    evidence: { kind: 'cost-mismatch', displayedCost: 1, responseCost: 100, expectedCost: 100 },
  });
  const after = await t.query(api.events.recentGenerations, { organizationId: ORG, userId: USER });
  expect(after[0]?.status).not.toBe('flagged');
});

test('limit bounds the payload to recent activity, newest-first', async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 5; i++) {
    await t.mutation(api.events.record, eventArgs({ toolRef: `set_${i}`, capturedAt: i + 1 }));
  }
  const rows = await t.query(api.events.recentGenerations, {
    organizationId: ORG,
    userId: USER,
    limit: 3,
  });
  expect(rows).toHaveLength(3);
  // capturedAt 5, 4, 3 — the three most recent.
  expect(rows.map((r) => r.capturedAt)).toEqual([5, 4, 3]);
});
