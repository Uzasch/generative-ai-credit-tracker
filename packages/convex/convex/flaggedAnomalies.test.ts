import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
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
