import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// Demo (issue #4, criterion 5): after a generation is recorded, its job(s)
// reach `completed` with a working media link, driven only by the passive status
// updates the extension observes on the tool's own polling traffic.
// Run with `pnpm --filter @token-tracker/convex test`.

const modules = import.meta.glob('./**/*.*s');
const ORG = 'org_studio';

test('demo: a recorded generation reaches completed with its media via passive polls', async () => {
  const t = convexTest(schema, modules);

  // 1. The generate response is recorded — one job set, its child job `queued`.
  //    (Cost/toolRef/prompt come from the adapter; job starts life as queued.)
  const jobId = '0b836048-2df4-455d-b513-6d248d544fec';
  await t.mutation(api.events.record, {
    organizationId: ORG,
    userId: 'user_ann',
    tool: 'higgsfield',
    brandId: 'brand_alpha',
    assetId: 'song_1',
    cost: 100,
    prompt: 'a friendly cartoon T-Rex',
    toolRef: 'c7d61713-24df-4195-85fd-e9846f092405',
    jobs: [{ jobId, status: 'queued' }],
    capturedAt: 1,
    ruleVersion: 1,
  });

  const jobOf = async () => {
    const usage = await t.query(api.events.usageByAsset, {
      organizationId: ORG,
      assetId: 'song_1',
    });
    const job = usage.events[0]?.jobs[0];
    if (job === undefined) throw new Error('expected the recorded job to be present');
    return job;
  };

  expect(await jobOf()).toEqual({ jobId, status: 'queued' });

  // 2. The tool's own `GET /fnf/jobs/{id}` polls are observed passively and
  //    applied — the job advances queued -> in_progress -> completed.
  await t.mutation(api.events.applyJobStatus, { jobId, status: 'in_progress' });
  expect((await jobOf()).status).toBe('in_progress');

  const mediaUrl = 'https://cdn.higgsfield.ai/generated/0b836048/raw.png';
  await t.mutation(api.events.applyJobStatus, { jobId, status: 'completed', mediaUrl });

  // 3. The job is completed and carries its result media link.
  const finished = await jobOf();
  expect(finished).toEqual({ jobId, status: 'completed', mediaUrl });

  console.log(
    `\nPassive outcome demo (issue #4):
  event asset song_1, job ${jobId}
    queued -> in_progress -> completed
    media: ${finished.mediaUrl}
`,
  );
});
