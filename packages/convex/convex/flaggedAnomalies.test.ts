import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

// convex-test loads every function module in this directory in-memory.
const modules = import.meta.glob('./**/*.*s');

const ORG = 'org_studio';
const OTHER_ORG = 'org_rival';

// Derived from the canonical `record` validator so the tests can't drift from
// the anomaly shape (AGENTS.md §2 — never re-declare cross-cutting types).
type AnomalyInput = FunctionArgs<typeof api.flaggedAnomalies.record>;

test('records a click-no-request anomaly with its raw evidence', async () => {
  const t = convexTest(schema, modules);
  const input: AnomalyInput = {
    organizationId: ORG,
    tool: 'higgsfield',
    observedAt: 1000,
    evidence: {
      kind: 'click-no-request',
      host: 'higgsfield.ai',
      clickedAt: 500,
      windowMs: 4000,
    },
  };
  const id = await t.mutation(api.flaggedAnomalies.record, input);
  expect(id).not.toBeNull();

  const rows = await t.query(api.flaggedAnomalies.listByOrg, { organizationId: ORG });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.tool).toBe('higgsfield');
  expect(rows[0]?.toolRef).toBeUndefined();
  expect(rows[0]?.evidence).toEqual(input.evidence);
});

test('records an unknown-status anomaly, keeping the raw status verbatim', async () => {
  const t = convexTest(schema, modules);
  const input: AnomalyInput = {
    organizationId: ORG,
    tool: 'higgsfield',
    toolRef: 'jobset_1',
    observedAt: 2000,
    evidence: {
      kind: 'unknown-status',
      jobId: 'job_9',
      // A status string the shared JobStatus union does not contain — kept raw,
      // never coerced into a known status (ADR-0002).
      rawStatus: 'quarantined',
      sourceUrl: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/job_9',
    },
  };
  await t.mutation(api.flaggedAnomalies.record, input);

  const rows = await t.query(api.flaggedAnomalies.listByOrg, { organizationId: ORG });
  expect(rows).toHaveLength(1);
  const evidence = rows[0]?.evidence;
  expect(evidence?.kind).toBe('unknown-status');
  if (evidence?.kind === 'unknown-status') {
    expect(evidence.rawStatus).toBe('quarantined');
    expect(evidence.jobId).toBe('job_9');
  }
  expect(rows[0]?.toolRef).toBe('jobset_1');
});

test('records a cost-mismatch anomaly, keeping both cost numbers as evidence', async () => {
  const t = convexTest(schema, modules);
  const input: AnomalyInput = {
    organizationId: ORG,
    tool: 'higgsfield',
    toolRef: 'jobset_7',
    observedAt: 3000,
    evidence: {
      kind: 'cost-mismatch',
      // Button showed "1 credit" but the response billed 250 internal units — the
      // ÷100 display rule broke for this model (ADR-0005 guardrail, #13).
      displayedCost: 1,
      responseCost: 250,
      expectedCost: 100,
    },
  };
  await t.mutation(api.flaggedAnomalies.record, input);

  const rows = await t.query(api.flaggedAnomalies.listByOrg, { organizationId: ORG });
  expect(rows).toHaveLength(1);
  const evidence = rows[0]?.evidence;
  expect(evidence?.kind).toBe('cost-mismatch');
  if (evidence?.kind === 'cost-mismatch') {
    expect(evidence.displayedCost).toBe(1);
    expect(evidence.responseCost).toBe(250);
    expect(evidence.expectedCost).toBe(100);
  }
  // The response cost is never overwritten by the button figure — this row is
  // evidence only, and the billable event keeps its captured cost elsewhere.
  expect(rows[0]?.toolRef).toBe('jobset_7');
});

test('denormalises the unknown-status job id to a top-level indexable field (#18 review)', async () => {
  // The `record` mutation hoists `evidence.jobId` to a top-level `jobId` so the live
  // indicator can reverse-look-up the anomaly through `by_org_job_id` (an
  // `unknown-status` anomaly carries no `toolRef`). Read it back via a raw table
  // scan since `listByOrg` projects the row shape the Discovery agent consumes.
  const t = convexTest(schema, modules);
  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: ORG,
    tool: 'higgsfield',
    observedAt: 2000,
    evidence: {
      kind: 'unknown-status',
      jobId: 'job_denorm',
      rawStatus: 'quarantined',
      sourceUrl: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/job_denorm',
    },
  });
  // A non-unknown-status arm links by toolRef (or not at all) and must NOT carry a
  // denormalised jobId.
  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: ORG,
    tool: 'higgsfield',
    toolRef: 'jobset_click',
    observedAt: 2001,
    evidence: { kind: 'click-no-request', host: 'higgsfield.ai', clickedAt: 1, windowMs: 4000 },
  });

  const rows = await t.run(async (ctx) =>
    ctx.db
      .query('flagged_anomalies')
      .withIndex('by_org_observed_at', (q) => q.eq('organizationId', ORG))
      .collect(),
  );
  const unknown = rows.find((r) => r.evidence.kind === 'unknown-status');
  const click = rows.find((r) => r.evidence.kind === 'click-no-request');
  expect(unknown?.jobId).toBe('job_denorm');
  expect(click?.jobId).toBeUndefined();

  // And the index it feeds resolves the anomaly by that job id, org-scoped.
  const byJob = await t.run(async (ctx) =>
    ctx.db
      .query('flagged_anomalies')
      .withIndex('by_org_job_id', (q) => q.eq('organizationId', ORG).eq('jobId', 'job_denorm'))
      .collect(),
  );
  expect(byJob).toHaveLength(1);
});

test('backfill denormalises jobId onto pre-existing unknown-status rows (#18 review)', async () => {
  // Simulate rows recorded BEFORE the top-level `jobId` existed: insert directly,
  // omitting `jobId`, exactly as an old `record` would have. The backfill must set
  // `jobId` from `evidence.jobId` so the `by_org_job_id` reverse lookup reaches them.
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    // A legacy unknown-status row with no denormalised jobId.
    await ctx.db.insert('flagged_anomalies', {
      organizationId: ORG,
      tool: 'higgsfield',
      observedAt: 1,
      evidence: {
        kind: 'unknown-status',
        jobId: 'legacy_job',
        rawStatus: 'weird',
        sourceUrl: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/legacy_job',
      },
    });
    // A legacy click row that must be left alone (it never links by job id).
    await ctx.db.insert('flagged_anomalies', {
      organizationId: ORG,
      tool: 'higgsfield',
      observedAt: 2,
      evidence: { kind: 'click-no-request', host: 'higgsfield.ai', clickedAt: 1, windowMs: 4000 },
    });
  });

  // Before the backfill the legacy row is unreachable by the job-id index.
  const before = await t.run(async (ctx) =>
    ctx.db
      .query('flagged_anomalies')
      .withIndex('by_org_job_id', (q) => q.eq('organizationId', ORG).eq('jobId', 'legacy_job'))
      .collect(),
  );
  expect(before).toHaveLength(0);

  const result = await t.mutation(internal.flaggedAnomalies.backfillUnknownStatusJobId, {});
  expect(result).toEqual({ patched: 1, done: true });

  // Now reachable by the index; the click row still carries no jobId.
  const after = await t.run(async (ctx) =>
    ctx.db
      .query('flagged_anomalies')
      .withIndex('by_org_job_id', (q) => q.eq('organizationId', ORG).eq('jobId', 'legacy_job'))
      .collect(),
  );
  expect(after).toHaveLength(1);

  // Idempotent: a second run patches nothing.
  const rerun = await t.mutation(internal.flaggedAnomalies.backfillUnknownStatusJobId, {});
  expect(rerun).toEqual({ patched: 0, done: true });
});

test('listByOrg returns newest-first', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: ORG,
    tool: 'higgsfield',
    observedAt: 1,
    evidence: { kind: 'click-no-request', host: 'higgsfield.ai', clickedAt: 1, windowMs: 4000 },
  });
  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: ORG,
    tool: 'higgsfield',
    observedAt: 2,
    evidence: {
      kind: 'unknown-status',
      jobId: 'job_2',
      rawStatus: 'weird',
      sourceUrl: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/job_2',
    },
  });

  const rows = await t.query(api.flaggedAnomalies.listByOrg, { organizationId: ORG });
  expect(rows.map((r) => r.evidence.kind)).toEqual(['unknown-status', 'click-no-request']);
});

test("org-scoping: a foreign org cannot read another org's anomalies", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: ORG,
    tool: 'higgsfield',
    observedAt: 1,
    evidence: { kind: 'click-no-request', host: 'higgsfield.ai', clickedAt: 1, windowMs: 4000 },
  });

  // The rival org queries with its OWN id (ADR-0004: every query is org-scoped)
  // and sees nothing — the `by_org` index isolates each tenant's anomalies.
  const foreign = await t.query(api.flaggedAnomalies.listByOrg, { organizationId: OTHER_ORG });
  expect(foreign).toHaveLength(0);

  // The owning org still sees its own row.
  const own = await t.query(api.flaggedAnomalies.listByOrg, { organizationId: ORG });
  expect(own).toHaveLength(1);
});
