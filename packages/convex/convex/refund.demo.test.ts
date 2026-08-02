import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// Demo (issue #17): the captured nsfw lifecycle end to end — a recorded
// generation whose job is rejected by content-safety nets out to 0 via a
// status-driven refund, and the wallet subscription_balance delta cross-checks
// the refunded amount. Driven by the finding's veo3_1_lite job
// (.scratch/higgsfield-tracking/findings/refund-signal-nsfw.md): cost 1200,
// queued → in_progress → nsfw → refund. Needs convex/_generated (CI), so it is
// deferred in a bare worktree.

const modules = import.meta.glob('./**/*.*s');
const ORG = 'org_studio';
const COST = 1200;
const TOOL_REF = 'c7d61713-24df-4195-85fd-e9846f092405';
const JOB_ID = '0b836048-2df4-455d-b513-6d248d544fec';

test('a content-safety rejection refunds the full cost and nets the asset to 0', async () => {
  const t = convexTest(schema, modules);

  // 1. The generate response is recorded — one job set, its child job queued.
  await t.mutation(api.events.record, {
    organizationId: ORG,
    userId: 'user_ann',
    tool: 'higgsfield',
    brandId: 'brand_alpha',
    assetId: 'song_1',
    cost: COST,
    prompt: 'spiderman running on a train with Lionel messi',
    toolRef: TOOL_REF,
    jobs: [{ jobId: JOB_ID, status: 'queued' }],
    capturedAt: 1,
    ruleVersion: 1,
  });

  const usage = () => t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'song_1' });

  // The charge stands in full while the job runs.
  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: JOB_ID,
    status: 'in_progress',
  });
  expect((await usage()).net).toBe(COST);

  // 2. The tool's own poll reports the terminal `nsfw` status. That transitions
  //    the event to refunded and nets its usage to 0 (finding rule 2).
  const refundAt = 1_009;
  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: JOB_ID,
    status: 'nsfw',
    at: refundAt,
  });

  const afterNsfw = await usage();
  expect(afterNsfw.net).toBe(0);
  const event = afterNsfw.events[0];
  expect(event?.jobs[0]?.status).toBe('nsfw');
  expect(event?.refund).toEqual({ kind: 'refunded', amount: COST, at: refundAt });

  // 3. The wallet subscription_balance delta (~9s later) independently
  //    cross-checks the refunded amount (finding rule 3).
  expect(
    await t.query(api.events.crossCheckWalletRefund, { toolRef: TOOL_REF, walletDelta: COST }),
  ).toEqual({
    kind: 'confirmed',
  });

  // A wallet delta that disagrees is a flagged mismatch, never silently trusted.
  const disagreement = await t.query(api.events.crossCheckWalletRefund, {
    toolRef: TOOL_REF,
    walletDelta: 1100,
  });
  expect(disagreement).toEqual({
    kind: 'mismatch',
    mismatch: {
      reason:
        'wallet subscription_balance refund delta disagrees with the status-derived job-set cost',
      statusAmount: COST,
      walletAmount: 1100,
    },
  });
});

test('a completed generation is never refunded', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, {
    organizationId: ORG,
    userId: 'user_ann',
    tool: 'higgsfield',
    brandId: 'brand_alpha',
    assetId: 'song_2',
    cost: 500,
    toolRef: 'set_ok',
    jobs: [{ jobId: 'job_ok', status: 'queued' }],
    capturedAt: 1,
    ruleVersion: 1,
  });
  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_ok',
    status: 'completed',
    mediaUrl: 'https://cdn.higgsfield.ai/job_ok.mp4',
  });

  const usage = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'song_2' });
  expect(usage.net).toBe(500); // full charge stands
  expect(usage.events[0]?.refund).toEqual({ kind: 'none' });
});

test('record rejects a negative refund amount at the write boundary', async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.events.record, {
      organizationId: ORG,
      userId: 'user_ann',
      tool: 'higgsfield',
      brandId: 'brand_alpha',
      assetId: 'song_3',
      cost: 100,
      refund: { kind: 'refunded', amount: -100, at: 2 },
      capturedAt: 1,
      ruleVersion: 1,
    }),
  ).rejects.toThrow(/finite, non-negative/);
});
