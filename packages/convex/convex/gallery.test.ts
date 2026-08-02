import type { JobOutcome } from '@token-tracker/shared';
import { expect, test } from 'vitest';
import {
  type GalleryEventInput,
  resultMedia,
  toGenerationView,
  toRecentGeneration,
} from './gallery';

// Pure gallery-projection logic — no database (AGENTS.md §9). The Convex queries
// that wrap these live in `events.ts` and are exercised by the convex-test
// integration suite (which needs `convex/_generated`).

test('resultMedia collects each completed job, tagging image vs video by URL', () => {
  // A video generation's `mediaUrl` ends `.mp4`; an image's `.png`. The kind is
  // classified here at the projection edge so the gallery renders <video> vs
  // <img> from an explicit discriminator (a video in an <img> shows broken).
  const jobs: JobOutcome[] = [
    { jobId: 'a', status: 'completed', mediaUrl: 'https://cdn/a.png' },
    { jobId: 'b', status: 'completed', mediaUrl: 'https://cdn/b.mp4' },
  ];
  expect(resultMedia(jobs)).toEqual([
    { url: 'https://cdn/a.png', kind: 'image' },
    { url: 'https://cdn/b.mp4', kind: 'video' },
  ]);
});

test('resultMedia classifies a video even behind a signed query string', () => {
  // Real result URLs are signed; the extension only ever sees the URL, so the
  // classifier must strip the query before matching the extension.
  const jobs: JobOutcome[] = [
    { jobId: 'a', status: 'completed', mediaUrl: 'https://cdn/clip.mp4?token=abc&x=1' },
  ];
  expect(resultMedia(jobs)).toEqual([{ url: 'https://cdn/clip.mp4?token=abc&x=1', kind: 'video' }]);
});

test('resultMedia skips a completed job that has no media url yet', () => {
  // A status-batch `completed` entry can arrive before its `results.raw.url`
  // (issue #4); it contributes no Result media until a later poll attaches one.
  const jobs: JobOutcome[] = [
    { jobId: 'a', status: 'completed' },
    { jobId: 'b', status: 'completed', mediaUrl: 'https://cdn/b.png' },
  ];
  expect(resultMedia(jobs)).toEqual([{ url: 'https://cdn/b.png', kind: 'image' }]);
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
  refund: { kind: 'none' },
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
    refund: { kind: 'none' },
    media: [{ url: 'https://cdn/j1.png', kind: 'image' }],
    jobCount: 1,
    capturedAt: 5,
  });
});

test('toRecentGeneration projects the lifecycle status and progress for the indicator', () => {
  // A completed job with no anomaly → generated, with 1-of-1 progress and Cost.
  expect(toRecentGeneration(baseEvent, false)).toEqual({
    id: 'event_1',
    tool: 'higgsfield',
    prompt: 'a raking-light still life',
    cost: 100,
    status: 'generated',
    refund: { kind: 'none' },
    jobCount: 1,
    completedCount: 1,
    capturedAt: 5,
  });
});

test('toRecentGeneration folds hasAnomaly into the status — flagged outranks the outcome', () => {
  // Same completed generation, but an anomaly references it → flagged wins.
  expect(toRecentGeneration(baseEvent, true).status).toBe('flagged');
});

test('toRecentGeneration reports refunded with the credited amount carried through', () => {
  const view = toRecentGeneration(
    { ...baseEvent, cost: 1200, refund: { kind: 'refunded', amount: 1200, at: 9 } },
    false,
  );
  expect(view.status).toBe('refunded');
  expect(view.refund).toEqual({ kind: 'refunded', amount: 1200, at: 9 });
});

test('toGenerationView carries the refund state through so the gallery can net it out', () => {
  // Refunds net out of usage (AGENTS.md §6); the projection must surface the
  // refund so a tray/ledger total can subtract it rather than sum the raw cost.
  const view = toGenerationView({
    ...baseEvent,
    cost: 750,
    refund: { kind: 'refunded', amount: 750, at: 9 },
  });
  expect(view.cost).toBe(750);
  expect(view.refund).toEqual({ kind: 'refunded', amount: 750, at: 9 });
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
  expect(view.media).toEqual([{ url: 'https://cdn/j1.png', kind: 'image' }]);
});
