import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// convex-test loads every function module in this directory in-memory.
const modules = import.meta.glob('./**/*.*s');

const ORG = 'org_studio';

// Derived from the canonical `record` validator so the test can't drift from
// the event shape (AGENTS.md §2 — never re-declare cross-cutting types).
type EventInput = FunctionArgs<typeof api.events.record>;

/** A fully-attributed Higgsfield event; override only what a test cares about. */
function eventArgs(overrides: Partial<EventInput> = {}): EventInput {
  return {
    organizationId: ORG,
    userId: 'user_a',
    tool: 'higgsfield',
    brandId: 'brand_x',
    assetId: 'asset_1',
    cost: 100,
    capturedAt: 1,
    ruleVersion: 1,
    ...overrides,
  };
}

test('net for an asset is the sum of its charges when nothing is refunded', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ cost: 100 }));
  await t.mutation(api.events.record, eventArgs({ cost: 500 }));

  const usage = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  expect(usage.net).toBe(600);
});

test('a refunded event reduces the asset total by the refunded amount', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ cost: 500 }));
  await t.mutation(
    api.events.record,
    eventArgs({ cost: 500, refund: { kind: 'refunded', amount: 200, at: 2 } }),
  );

  const usage = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  // 500 charged + (500 charged − 200 refunded) = 800
  expect(usage.net).toBe(800);
});

test('a fully refunded event nets out of the total', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({ cost: 750, refund: { kind: 'refunded', amount: 750, at: 2 } }),
  );

  const usage = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  expect(usage.net).toBe(0);
});

test('an unattributed event is excluded from any asset total but counts at brand and org level', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'asset_1', cost: 100 }));
  await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed', cost: 500 }));

  const asset = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  const brand = await t.query(api.events.usageByBrand, { organizationId: ORG, brandId: 'brand_x' });
  const org = await t.query(api.events.usageByOrg, { organizationId: ORG });

  expect(asset.net).toBe(100); // unattributed excluded from the asset
  expect(brand.net).toBe(600); // but included at the brand
  expect(org.net).toBe(600); // and the org
});

test("the 'unattributed' sentinel cannot be queried as an asset total", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed', cost: 500 }));

  // 'unattributed' is not an Asset, so an Asset roll-up must refuse it rather
  // than report its credits as an asset total.
  await expect(
    t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'unattributed' }),
  ).rejects.toThrow(/not an Asset/);
});

test('per-user usage is an independent axis from asset/brand', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ userId: 'user_a', cost: 100 }));
  await t.mutation(api.events.record, eventArgs({ userId: 'user_a', cost: 300 }));
  await t.mutation(api.events.record, eventArgs({ userId: 'user_b', cost: 500 }));

  const a = await t.query(api.events.usageByUser, { organizationId: ORG, userId: 'user_a' });
  const b = await t.query(api.events.usageByUser, { organizationId: ORG, userId: 'user_b' });
  expect(a.net).toBe(400);
  expect(b.net).toBe(500);
});

test('roll-ups are isolated per organization', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ organizationId: ORG, cost: 100 }));
  await t.mutation(api.events.record, eventArgs({ organizationId: 'org_other', cost: 999 }));

  const mine = await t.query(api.events.usageByOrg, { organizationId: ORG });
  const asset = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  expect(mine.net).toBe(100); // the other org's 999 is not visible
  expect(asset.net).toBe(100);
});

// The write boundary enforces AGENTS.md §6: the assignment flag mirrors the
// `'unattributed'` assetId sentinel, so a contradictory event can never persist.

test('an unattributed event is stored needs-assignment even when assignment is omitted', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed', brandId: 'brand_x' }));

  // usageByBrand includes unattributed events; usageByAsset refuses the sentinel.
  const brand = await t.query(api.events.usageByBrand, { organizationId: ORG, brandId: 'brand_x' });
  expect(brand.events).toHaveLength(1);
  expect(brand.events[0]?.assignment).toStrictEqual({ status: 'needs-assignment' });
});

test('a real Asset event is stored assigned', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'asset_1', brandId: 'brand_x' }));

  const brand = await t.query(api.events.usageByBrand, { organizationId: ORG, brandId: 'brand_x' });
  expect(brand.events[0]?.assignment).toStrictEqual({ status: 'assigned' });
});

test('record rejects an assignment that contradicts the assetId', async () => {
  const t = convexTest(schema, modules);

  // unattributed asset must not pair with 'assigned'
  await expect(
    t.mutation(
      api.events.record,
      eventArgs({ assetId: 'unattributed', assignment: { status: 'assigned' } }),
    ),
  ).rejects.toThrow(/contradicts assetId/);

  // a real Asset must not pair with 'needs-assignment'
  await expect(
    t.mutation(
      api.events.record,
      eventArgs({ assetId: 'asset_1', assignment: { status: 'needs-assignment' } }),
    ),
  ).rejects.toThrow(/contradicts assetId/);
});

// --- applyJobStatus: passive outcome correlation (issue #4) --------------------
// A status poll observed by the extension carries only a job id + status (+ media
// on completion). The mutation correlates it back to the event that owns that
// job and patches the matching JobOutcome in `jobs[]`, leaving siblings alone.

/** Read back the single event we recorded for `asset_1`, with its current jobs. */
async function jobsOf(
  t: ReturnType<typeof convexTest>,
  assetId = 'asset_1',
): Promise<Array<{ jobId: string; status: string; mediaUrl?: string }>> {
  const usage = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId });
  const event = usage.events[0];
  if (event === undefined) throw new Error(`no event recorded for asset ${assetId}`);
  return event.jobs;
}

test('a job transitions queued -> in_progress -> completed and gains its media url', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({ toolRef: 'set_1', jobs: [{ jobId: 'job_1', status: 'queued' }] }),
  );

  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_1',
    status: 'in_progress',
  });
  expect((await jobsOf(t))[0]).toEqual({ jobId: 'job_1', status: 'in_progress' });

  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_1',
    status: 'completed',
    mediaUrl: 'https://cdn.higgsfield.ai/job_1.png',
  });
  expect((await jobsOf(t))[0]).toEqual({
    jobId: 'job_1',
    status: 'completed',
    mediaUrl: 'https://cdn.higgsfield.ai/job_1.png',
  });
});

test('applyJobStatus patches only the matching job, leaving batch siblings untouched', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({
      jobs: [
        { jobId: 'job_a', status: 'queued' },
        { jobId: 'job_b', status: 'queued' },
      ],
    }),
  );

  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_b',
    status: 'completed',
    mediaUrl: 'https://cdn.higgsfield.ai/job_b.mp4',
  });

  const jobs = await jobsOf(t);
  expect(jobs).toContainEqual({ jobId: 'job_a', status: 'queued' });
  expect(jobs).toContainEqual({
    jobId: 'job_b',
    status: 'completed',
    mediaUrl: 'https://cdn.higgsfield.ai/job_b.mp4',
  });
});

test('applyJobStatus does not regress a completed job when a stale poll arrives', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({
      jobs: [{ jobId: 'job_1', status: 'completed', mediaUrl: 'https://cdn/final.png' }],
    }),
  );

  // A late in_progress poll (out-of-order delivery) must not undo completion.
  const changed = await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_1',
    status: 'in_progress',
  });
  expect(changed).toBeNull();
  expect((await jobsOf(t))[0]).toEqual({
    jobId: 'job_1',
    status: 'completed',
    mediaUrl: 'https://cdn/final.png',
  });
});

test('applyJobStatus attaches media to a job already completed without it', async () => {
  const t = convexTest(schema, modules);
  // A completed poll can arrive before its media (e.g. a status-batch completed
  // entry whose `results` were absent). A later poll carrying the URL must still
  // attach it even though the job is already terminal.
  await t.mutation(
    api.events.record,
    eventArgs({ jobs: [{ jobId: 'job_1', status: 'completed' }] }),
  );

  const changed = await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_1',
    status: 'completed',
    mediaUrl: 'https://cdn.higgsfield.ai/late.png',
  });
  expect(changed).not.toBeNull();
  expect((await jobsOf(t))[0]).toEqual({
    jobId: 'job_1',
    status: 'completed',
    mediaUrl: 'https://cdn.higgsfield.ai/late.png',
  });
});

test('applyJobStatus is a no-op for a job id it has never seen', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ jobs: [{ jobId: 'job_1', status: 'queued' }] }));

  const changed = await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_unknown',
    status: 'completed',
  });
  expect(changed).toBeNull();
  expect((await jobsOf(t))[0]).toEqual({ jobId: 'job_1', status: 'queued' });
});

test("applyJobStatus is scoped to its organization: another org's poll cannot patch this event", async () => {
  const t = convexTest(schema, modules);
  // Same job id lives under our org; a poll arriving for a different org must not
  // reach across the tenant boundary (AGENTS.md §6, ADR-0004).
  await t.mutation(api.events.record, eventArgs({ jobs: [{ jobId: 'job_1', status: 'queued' }] }));

  const changed = await t.mutation(api.events.applyJobStatus, {
    organizationId: 'org_other',
    jobId: 'job_1',
    status: 'completed',
    mediaUrl: 'https://cdn/should-not-apply.png',
  });
  expect(changed).toBeNull();
  expect((await jobsOf(t))[0]).toEqual({ jobId: 'job_1', status: 'queued' });

  // The correct org still correlates and patches it.
  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_1',
    status: 'in_progress',
  });
  expect((await jobsOf(t))[0]).toEqual({ jobId: 'job_1', status: 'in_progress' });
});

// --- assignAsset + gallery views (issue #7) -----------------------------------
// The gallery lists a generation as prompt + Result media + Cost, and Assignment
// (assignAsset) moves an unattributed event onto an Asset, clearing its flag.

test('assignAsset files an unattributed event under an Asset and clears its flag', async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.mutation(
    api.events.record,
    eventArgs({ assetId: 'unattributed', brandId: 'brand_x', cost: 100 }),
  );

  // Before: it is the org's only intake-tray item, in neither asset total.
  const trayBefore = await t.query(api.events.unattributedGenerations, { organizationId: ORG });
  expect(trayBefore).toHaveLength(1);
  expect(trayBefore[0]?.assignment).toEqual({ status: 'needs-assignment' });

  const returned = await t.mutation(api.events.assignAsset, {
    organizationId: ORG,
    eventId,
    assetId: 'asset_1',
  });
  expect(returned).toBe(eventId);

  // After: the intake tray is empty and the event rolls up to its Asset.
  const trayAfter = await t.query(api.events.unattributedGenerations, { organizationId: ORG });
  expect(trayAfter).toHaveLength(0);
  const asset = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  expect(asset.net).toBe(100);
  expect(asset.events[0]?.assignment).toEqual({ status: 'assigned' });
});

test('assignAsset refuses the unattributed sentinel as a target', async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed' }));
  await expect(
    t.mutation(api.events.assignAsset, { organizationId: ORG, eventId, assetId: 'unattributed' }),
  ).rejects.toThrow(/not an Asset/);
});

test('assignAsset is org-scoped: another org cannot file this event', async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed' }));
  await expect(
    t.mutation(api.events.assignAsset, {
      organizationId: 'org_other',
      eventId,
      assetId: 'asset_1',
    }),
  ).rejects.toThrow(/not found in this Organization/);
});

test('assignAsset is idempotent when re-filing under the same Asset', async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed' }));
  await t.mutation(api.events.assignAsset, { organizationId: ORG, eventId, assetId: 'asset_1' });
  // A double-submit in batch triage must not error.
  const again = await t.mutation(api.events.assignAsset, {
    organizationId: ORG,
    eventId,
    assetId: 'asset_1',
  });
  expect(again).toBe(eventId);
});

test('assignAsset refuses to re-attribute an assigned event to a different Asset', async () => {
  const t = convexTest(schema, modules);
  const eventId = await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed' }));
  await t.mutation(api.events.assignAsset, { organizationId: ORG, eventId, assetId: 'asset_1' });
  await expect(
    t.mutation(api.events.assignAsset, { organizationId: ORG, eventId, assetId: 'asset_2' }),
  ).rejects.toThrow(/out of scope/);
});

test('generationsByUser returns the editor feed as prompt + Result media + Cost', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({
      userId: 'user_a',
      prompt: 'a raking-light still life',
      cost: 100,
      jobs: [{ jobId: 'j1', status: 'completed', mediaUrl: 'https://cdn/j1.png' }],
    }),
  );
  // Another editor's work must not appear in this feed.
  await t.mutation(api.events.record, eventArgs({ userId: 'user_b', cost: 999 }));

  const feed = await t.query(api.events.generationsByUser, {
    organizationId: ORG,
    userId: 'user_a',
  });
  expect(feed).toHaveLength(1);
  expect(feed[0]).toMatchObject({
    prompt: 'a raking-light still life',
    cost: 100,
    media: ['https://cdn/j1.png'],
    jobCount: 1,
  });
});

test('generationsByAsset lists an Asset feed and refuses the unattributed sentinel', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'asset_1', cost: 500 }));
  await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed', cost: 100 }));

  const feed = await t.query(api.events.generationsByAsset, {
    organizationId: ORG,
    assetId: 'asset_1',
  });
  expect(feed).toHaveLength(1);
  expect(feed[0]?.cost).toBe(500);

  await expect(
    t.query(api.events.generationsByAsset, { organizationId: ORG, assetId: 'unattributed' }),
  ).rejects.toThrow(/not an Asset/);
});
