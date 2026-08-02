import { describe, expect, it } from 'vitest';
import { higgsfieldAdapter } from './higgsfield';
import { extractUsage } from './index';
import type { CapturedResponse } from './types';

import freeImage from './__fixtures__/higgsfield/generate-free-image.json';
import multiImage from './__fixtures__/higgsfield/generate-multi-image.json';
import paidImage from './__fixtures__/higgsfield/generate-paid-image.json';
import videoKling2 from './__fixtures__/higgsfield/generate-video-kling2_6.json';
import videoKling3 from './__fixtures__/higgsfield/generate-video-kling3_0_turbo.json';
import userProfile from './__fixtures__/higgsfield/non-match-user.json';
import statusBatch from './__fixtures__/higgsfield/status-batch.json';
import statusCompleted from './__fixtures__/higgsfield/status-image-completed.json';
import statusInProgress from './__fixtures__/higgsfield/status-image-in-progress.json';

/**
 * Fixture-driven tests for the Higgsfield adapter (AGENTS.md §9). Each fixture is
 * a real captured `fnf-api-gw` response (secrets stripped) shaped as the MAIN-world
 * probe delivers it. We assert external behaviour — given a captured response, what
 * usage comes out — never internal structure.
 *
 * Provenance: all fixtures are real captures with user/project ids redacted.
 * `generate-multi-image`, `status-image-completed`, and `status-batch` come from a
 * captured 3-output ("batch_size: 3") generation: one job set at `cost: 300` with
 * three child jobs; each job's media arrives on its own `GET /fnf/jobs/{id}` at
 * `results.raw.url`; the `POST /fnf/jobs/status-batch` response reports per-job
 * status only (no media) under `{ items: [...], missing: [...] }`. The
 * `status-batch` fixture combines real item shapes at mixed statuses to exercise
 * the reader.
 */

/** Build the CapturedResponse the adapter sees from a stored capture fixture. */
function asResponse(fixture: {
  url: string;
  method: string;
  status: number;
  body: unknown;
}): CapturedResponse {
  return {
    url: fixture.url,
    method: fixture.method,
    status: fixture.status,
    body: fixture.body,
  };
}

describe('higgsfieldAdapter.extract — generate responses', () => {
  it('reads a paid image generate: cost 100, job-set toolRef, prompt, one child job, tool seat', () => {
    const usage = higgsfieldAdapter.extract(asResponse(paidImage));
    expect(usage?.kind).toBe('generation');
    if (usage?.kind !== 'generation') throw new Error('expected a generation extract');
    expect(usage.cost).toBe(100);
    expect(usage.toolRef).toBe('c7d61713-24df-4195-85fd-e9846f092405');
    expect(usage.jobIds).toEqual(['0b836048-2df4-455d-b513-6d248d544fec']);
    expect(usage.prompt).toMatch(/^2D hand-drawn cartoon/);
    // The shared tool seat is captured as metadata (ADR-0004), from the job's
    // tool-side `user_id` (stripped to 'REDACTED_USER' in the fixture).
    expect(usage.toolAccount).toBe('REDACTED_USER');
  });

  it('leaves toolAccount undefined when the generate response carries no job user_id', () => {
    const noSeat: CapturedResponse = {
      url: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/v2/nano_banana',
      method: 'POST',
      status: 200,
      body: {
        job_sets: [{ id: 'js_1', cost: 100, params: { prompt: 'x' }, jobs: [{ id: 'j1' }] }],
      },
    };
    const usage = higgsfieldAdapter.extract(noSeat);
    if (usage?.kind !== 'generation') throw new Error('expected a generation extract');
    expect(usage.toolAccount).toBeUndefined();
  });

  it('reads a free generate (cost null) as cost 0', () => {
    const usage = higgsfieldAdapter.extract(asResponse(freeImage));
    expect(usage?.kind).toBe('generation');
    if (usage?.kind !== 'generation') throw new Error('expected a generation extract');
    expect(usage.cost).toBe(0);
    expect(usage.toolRef).toBe('8d23dcd0-547d-4d54-80d9-6da56b3804c3');
    expect(usage.jobIds).toEqual(['2507f6c2-1651-41fd-a110-b29049fb4dd7']);
  });

  it('reads a kling2_6 video generate: cost 500', () => {
    const usage = higgsfieldAdapter.extract(asResponse(videoKling2));
    if (usage?.kind !== 'generation') throw new Error('expected a generation extract');
    expect(usage.cost).toBe(500);
    expect(usage.toolRef).toBe('d06d1b93-8e54-458b-b1a3-548d9d4cc66e');
    expect(usage.jobIds).toEqual(['b3473756-0857-4b76-b3e1-555e4da41614']);
  });

  it('reads a kling3_0_turbo video generate (POST /fnf/jobs/v2/{type}): cost 750', () => {
    const usage = higgsfieldAdapter.extract(asResponse(videoKling3));
    if (usage?.kind !== 'generation') throw new Error('expected a generation extract');
    expect(usage.cost).toBe(750);
    expect(usage.toolRef).toBe('a75cb1b5-e9a0-447c-8ef5-3467f33de3ba');
    expect(usage.jobIds).toEqual(['5488b706-cf6f-4799-9b57-da998578bc9b']);
  });

  it('reads a multi-output generate (batch_size 3): whole-set cost 300, one toolRef, three child jobs', () => {
    // One click = one job set = one charge (300 = 100 × 3), holding three jobs
    // that each finish independently (spec: event = one Job set, N Jobs).
    const usage = higgsfieldAdapter.extract(asResponse(multiImage));
    if (usage?.kind !== 'generation') throw new Error('expected a generation extract');
    expect(usage.cost).toBe(300);
    expect(usage.toolRef).toBe('0d547efb-b757-437d-a566-890428d1115d');
    expect(usage.jobIds).toEqual([
      '41f3d26d-8fae-43af-ad8f-ea7382d2e074',
      '7f9aab41-412a-40f0-a2da-b2708eb594b2',
      '076c2117-8ade-41f8-ab33-395c2e1f7fe5',
    ]);
  });
});

describe('higgsfieldAdapter.extract — status responses (passive outcome updates)', () => {
  it('reads a GET /fnf/jobs/{id} in_progress poll: one update, no media yet', () => {
    const usage = higgsfieldAdapter.extract(asResponse(statusInProgress));
    expect(usage?.kind).toBe('status');
    if (usage?.kind !== 'status') throw new Error('expected a status extract');
    expect(usage.updates).toEqual([
      { jobId: '0b836048-2df4-455d-b513-6d248d544fec', status: 'in_progress' },
    ]);
  });

  it('reads a GET /fnf/jobs/{id} completed poll: status completed with the result media url', () => {
    const usage = higgsfieldAdapter.extract(asResponse(statusCompleted));
    if (usage?.kind !== 'status') throw new Error('expected a status extract');
    expect(usage.updates).toEqual([
      {
        jobId: '41f3d26d-8fae-43af-ad8f-ea7382d2e074',
        status: 'completed',
        mediaUrl:
          'https://d8j0ntlcm91z4.cloudfront.net/user_REDACTED/hf_20260802_051151_41f3d26d-8fae-43af-ad8f-ea7382d2e074.png',
      },
    ]);
  });

  it('reads a POST /fnf/jobs/status-batch: one status update per item, no media (media is on the per-job poll)', () => {
    // Real batch shape: { items: [{ id, status }], missing: [] } — status only.
    const usage = higgsfieldAdapter.extract(asResponse(statusBatch));
    if (usage?.kind !== 'status') throw new Error('expected a status extract');
    expect(usage.updates).toEqual([
      { jobId: '076c2117-8ade-41f8-ab33-395c2e1f7fe5', status: 'in_progress' },
      { jobId: '41f3d26d-8fae-43af-ad8f-ea7382d2e074', status: 'completed' },
      { jobId: '7f9aab41-412a-40f0-a2da-b2708eb594b2', status: 'queued' },
    ]);
  });

  it('passes an unknown terminal status (e.g. nsfw) through verbatim for the caller to flag', () => {
    // ADR-0002 / issue #4 comment: the adapter reports what it saw; classifying
    // `nsfw` as terminal-vs-unknown is the caller's job (falls through to the
    // unknown-status flag, issue #8). The adapter must not silently drop it.
    const nsfw: CapturedResponse = {
      url: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/0b836048-2df4-455d-b513-6d248d544fec',
      method: 'GET',
      status: 200,
      body: { id: '0b836048-2df4-455d-b513-6d248d544fec', status: 'nsfw' },
    };
    const usage = higgsfieldAdapter.extract(nsfw);
    if (usage?.kind !== 'status') throw new Error('expected a status extract');
    expect(usage.updates).toEqual([
      { jobId: '0b836048-2df4-455d-b513-6d248d544fec', status: 'nsfw' },
    ]);
  });
});

describe('higgsfieldAdapter.extract — responses it does not care about', () => {
  it('returns null for a /fnf/user profile response', () => {
    expect(higgsfieldAdapter.extract(asResponse(userProfile))).toBeNull();
  });

  it('returns null for a /fnf/tours response', () => {
    const tours: CapturedResponse = {
      url: 'https://fnf-api-gw.higgsfield.ai/fnf/tours',
      method: 'GET',
      status: 200,
      body: { items: [] },
    };
    expect(higgsfieldAdapter.extract(tours)).toBeNull();
  });

  it('returns null for a GET /fnf/jobs/{id} whose body carries no id/status', () => {
    // Same URL shape as a status poll, but not a job payload (e.g. an error body).
    const notAJob: CapturedResponse = {
      url: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/accessible',
      method: 'GET',
      status: 200,
      body: { detail: 'not found' },
    };
    expect(higgsfieldAdapter.extract(notAJob)).toBeNull();
  });
});

describe('higgsfieldAdapter.extract — deterministic recognition edges', () => {
  it('rejects a generate-shaped body whose cost is neither a number nor null', () => {
    const malformedCost: CapturedResponse = {
      url: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/v2/nano_banana_2_lite',
      method: 'POST',
      status: 200,
      body: { job_sets: [{ id: 'js_1', cost: 'gratis', params: { prompt: 'x' }, jobs: [] }] },
    };
    expect(higgsfieldAdapter.extract(malformedCost)).toBeNull();
  });

  it('does not treat POST /fnf/jobs/status-batch as a generate even when the body looks generate-shaped', () => {
    const statusBatchShaped: CapturedResponse = {
      url: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/status-batch',
      method: 'POST',
      status: 200,
      body: { job_sets: [{ id: 'js_1', cost: 100, params: { prompt: 'x' }, jobs: [] }] },
    };
    // Not a generate (never a new event); and with no job array it yields no updates.
    expect(higgsfieldAdapter.extract(statusBatchShaped)).toBeNull();
  });
});

describe('extractUsage routes a Higgsfield generate to the higgsfield adapter', () => {
  it('tags the paid image usage as tool "higgsfield"', () => {
    const result = extractUsage(asResponse(paidImage));
    expect(result?.tool).toBe('higgsfield');
    if (result?.usage.kind !== 'generation') throw new Error('expected a generation extract');
    expect(result.usage.cost).toBe(100);
  });

  it('routes a status poll to the higgsfield adapter as a status extract', () => {
    const result = extractUsage(asResponse(statusCompleted));
    expect(result?.tool).toBe('higgsfield');
    expect(result?.usage.kind).toBe('status');
  });
});
