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
    await t.query(api.events.crossCheckWalletRefund, {
      organizationId: ORG,
      toolRef: TOOL_REF,
      walletDelta: COST,
    }),
  ).toEqual({
    kind: 'confirmed',
  });

  // A wallet delta that disagrees is a flagged mismatch, never silently trusted.
  const disagreement = await t.query(api.events.crossCheckWalletRefund, {
    organizationId: ORG,
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

// Finding 1 (tenant leak): the wallet cross-check is org-scoped, so a caller in
// one org can never resolve — nor cross-check against — another org's event that
// happens to share the same tool-side `toolRef`. Two orgs record the SAME
// `toolRef`; each org resolves only its own event, and a foreign org sees
// `no-event` rather than the other tenant's refund state.
test('crossCheckWalletRefund is org-scoped: a foreign org cannot resolve another tenant refund', async () => {
  const t = convexTest(schema, modules);
  const sharedRef = 'dup_tool_ref';

  // Org A: a refunded event under the shared toolRef.
  await t.mutation(api.events.record, {
    organizationId: 'org_a',
    userId: 'user_a',
    tool: 'higgsfield',
    brandId: 'brand_a',
    assetId: 'asset_a',
    cost: 500,
    toolRef: sharedRef,
    jobs: [{ jobId: 'job_a', status: 'queued' }],
    capturedAt: 1,
    ruleVersion: 1,
  });
  await t.mutation(api.events.applyJobStatus, {
    organizationId: 'org_a',
    jobId: 'job_a',
    status: 'nsfw',
    at: 10,
  });

  // Org B: a DIFFERENT event, still charged, reusing the same toolRef value.
  await t.mutation(api.events.record, {
    organizationId: 'org_b',
    userId: 'user_b',
    tool: 'higgsfield',
    brandId: 'brand_b',
    assetId: 'asset_b',
    cost: 999,
    toolRef: sharedRef,
    jobs: [{ jobId: 'job_b', status: 'queued' }],
    capturedAt: 1,
    ruleVersion: 1,
  });

  // Org A resolves ONLY its own refunded event — the duplicate toolRef in org B
  // does not make the org-scoped `.unique()` throw, and the org-A refund (500)
  // confirms against a 500 wallet delta.
  expect(
    await t.query(api.events.crossCheckWalletRefund, {
      organizationId: 'org_a',
      toolRef: sharedRef,
      walletDelta: 500,
    }),
  ).toEqual({ kind: 'confirmed' });

  // Org B resolves ONLY its own (un-refunded) event: recorded amount is 0, so a
  // real 999 wallet delta surfaces as a mismatch — it never reads org A's 500.
  expect(
    await t.query(api.events.crossCheckWalletRefund, {
      organizationId: 'org_b',
      toolRef: sharedRef,
      walletDelta: 999,
    }),
  ).toEqual({
    kind: 'mismatch',
    mismatch: {
      reason:
        'wallet subscription_balance refund delta disagrees with the status-derived job-set cost',
      statusAmount: 0,
      walletAmount: 999,
    },
  });

  // A caller in a third org with no such event sees nothing — not a foreign one.
  expect(
    await t.query(api.events.crossCheckWalletRefund, {
      organizationId: 'org_none',
      toolRef: sharedRef,
      walletDelta: 500,
    }),
  ).toEqual({ kind: 'no-event' });
});

// Finding 2 (over-refund): a multi-job set whose FIRST job fails must NOT
// auto-refund the whole `event.cost` — that would over-refund the siblings that
// may still complete. Partial-batch reconciliation is deferred (spec/ADR-0001),
// so the refund state is left unchanged and the charge stands in full.
test('a multi-job event is not fully refunded when one job fails', async () => {
  const t = convexTest(schema, modules);
  const COST_MULTI = 1000;
  await t.mutation(api.events.record, {
    organizationId: ORG,
    userId: 'user_ann',
    tool: 'higgsfield',
    brandId: 'brand_alpha',
    assetId: 'song_multi',
    cost: COST_MULTI,
    toolRef: 'set_multi',
    jobs: [
      { jobId: 'job_1', status: 'queued' },
      { jobId: 'job_2', status: 'queued' },
    ],
    capturedAt: 1,
    ruleVersion: 1,
  });

  // One of the two jobs is rejected by content-safety.
  await t.mutation(api.events.applyJobStatus, {
    organizationId: ORG,
    jobId: 'job_1',
    status: 'nsfw',
    at: 10,
  });

  const usage = await t.query(api.events.usageByAsset, {
    organizationId: ORG,
    assetId: 'song_multi',
  });
  // The failing job's status is recorded, but the refund is left untouched and
  // the full charge stands — no whole-set over-refund on a partial batch.
  const event = usage.events[0];
  expect(event?.jobs.find((j) => j.jobId === 'job_1')?.status).toBe('nsfw');
  expect(event?.refund).toEqual({ kind: 'none' });
  expect(usage.net).toBe(COST_MULTI);
});
