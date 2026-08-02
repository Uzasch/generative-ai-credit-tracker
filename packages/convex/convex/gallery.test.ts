import type { JobOutcome } from '@token-tracker/shared';
import { expect, test } from 'vitest';
import { type GalleryEventInput, resultMedia, toGenerationView } from './gallery';

// Pure gallery-projection logic — no database (AGENTS.md §9). The Convex queries
// that wrap these live in `events.ts` and are exercised by the convex-test
// integration suite (which needs `convex/_generated`).

test('resultMedia collects the url of every completed job, in order', () => {
  const jobs: JobOutcome[] = [
    { jobId: 'a', status: 'completed', mediaUrl: 'https://cdn/a.png' },
    { jobId: 'b', status: 'completed', mediaUrl: 'https://cdn/b.mp4' },
  ];
  expect(resultMedia(jobs)).toEqual(['https://cdn/a.png', 'https://cdn/b.mp4']);
});

test('resultMedia skips a completed job that has no media url yet', () => {
  // A status-batch `completed` entry can arrive before its `results.raw.url`
  // (issue #4); it contributes no Result media until a later poll attaches one.
  const jobs: JobOutcome[] = [
    { jobId: 'a', status: 'completed' },
    { jobId: 'b', status: 'completed', mediaUrl: 'https://cdn/b.png' },
  ];
  expect(resultMedia(jobs)).toEqual(['https://cdn/b.png']);
});

test('resultMedia yields no media for in-flight or failed jobs', () => {
  const jobs: JobOutcome[] = [
    { jobId: 'a', status: 'queued' },
    { jobId: 'b', status: 'in_progress' },
    { jobId: 'c', status: 'failed' },
    { jobId: 'd', status: 'nsfw' },
  ];
  expect(resultMedia(jobs)).toEqual([]);
});

test('resultMedia of an empty job set is empty', () => {
  expect(resultMedia([])).toEqual([]);
});

const baseEvent: GalleryEventInput = {
  _id: 'event_1',
  tool: 'higgsfield',
  userId: 'user_a',
  brandId: 'brand_x',
  assetId: 'asset_1',
  assignment: { status: 'assigned' },
  prompt: 'a raking-light still life',
  cost: 100,
  jobs: [{ jobId: 'j1', status: 'completed', mediaUrl: 'https://cdn/j1.png' }],
  capturedAt: 5,
};

test('toGenerationView projects prompt, Cost, and Result media onto the view', () => {
  expect(toGenerationView(baseEvent)).toEqual({
    id: 'event_1',
    tool: 'higgsfield',
    userId: 'user_a',
    brandId: 'brand_x',
    assetId: 'asset_1',
    assignment: { status: 'assigned' },
    prompt: 'a raking-light still life',
    cost: 100,
    media: ['https://cdn/j1.png'],
    jobCount: 1,
    capturedAt: 5,
  });
});

test('toGenerationView carries the unattributed sentinel and needs-assignment flag through', () => {
  const view = toGenerationView({
    ...baseEvent,
    assetId: 'unattributed',
    assignment: { status: 'needs-assignment' },
  });
  expect(view.assetId).toBe('unattributed');
  expect(view.assignment).toEqual({ status: 'needs-assignment' });
});

test('toGenerationView reports jobCount independent of how many jobs have media', () => {
  const view = toGenerationView({
    ...baseEvent,
    jobs: [
      { jobId: 'j1', status: 'completed', mediaUrl: 'https://cdn/j1.png' },
      { jobId: 'j2', status: 'in_progress' },
    ],
  });
  expect(view.jobCount).toBe(2);
  expect(view.media).toEqual(['https://cdn/j1.png']);
});
