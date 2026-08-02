import { describe, expect, it } from 'vitest';
import { higgsfieldAdapter } from './higgsfield';
import { extractUsage } from './index';
import type { CapturedResponse } from './types';

import freeImage from './__fixtures__/higgsfield/generate-free-image.json';
import paidImage from './__fixtures__/higgsfield/generate-paid-image.json';
import videoKling2 from './__fixtures__/higgsfield/generate-video-kling2_6.json';
import videoKling3 from './__fixtures__/higgsfield/generate-video-kling3_0_turbo.json';
import jobStatusPoll from './__fixtures__/higgsfield/non-match-job-status.json';
import userProfile from './__fixtures__/higgsfield/non-match-user.json';

/**
 * Fixture-driven tests for the Higgsfield adapter (AGENTS.md §9). Each fixture is
 * a real captured `fnf-api-gw` response (secrets stripped) shaped as the MAIN-world
 * probe delivers it. We assert external behaviour — given a captured response, what
 * usage comes out — never internal structure.
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
  it('reads a paid image generate: cost 100, job-set toolRef, prompt, one child job', () => {
    const usage = higgsfieldAdapter.extract(asResponse(paidImage));
    expect(usage).not.toBeNull();
    expect(usage?.cost).toBe(100);
    expect(usage?.toolRef).toBe('c7d61713-24df-4195-85fd-e9846f092405');
    expect(usage?.jobIds).toEqual(['0b836048-2df4-455d-b513-6d248d544fec']);
    expect(usage?.prompt).toMatch(/^2D hand-drawn cartoon/);
  });

  it('reads a free generate (cost null) as cost 0', () => {
    const usage = higgsfieldAdapter.extract(asResponse(freeImage));
    expect(usage).not.toBeNull();
    expect(usage?.cost).toBe(0);
    expect(usage?.toolRef).toBe('8d23dcd0-547d-4d54-80d9-6da56b3804c3');
    expect(usage?.jobIds).toEqual(['2507f6c2-1651-41fd-a110-b29049fb4dd7']);
  });

  it('reads a kling2_6 video generate: cost 500', () => {
    const usage = higgsfieldAdapter.extract(asResponse(videoKling2));
    expect(usage?.cost).toBe(500);
    expect(usage?.toolRef).toBe('d06d1b93-8e54-458b-b1a3-548d9d4cc66e');
    expect(usage?.jobIds).toEqual(['b3473756-0857-4b76-b3e1-555e4da41614']);
  });

  it('reads a kling3_0_turbo video generate (POST /fnf/jobs/v2/{type}): cost 750', () => {
    const usage = higgsfieldAdapter.extract(asResponse(videoKling3));
    expect(usage?.cost).toBe(750);
    expect(usage?.toolRef).toBe('a75cb1b5-e9a0-447c-8ef5-3467f33de3ba');
    expect(usage?.jobIds).toEqual(['5488b706-cf6f-4799-9b57-da998578bc9b']);
  });
});

describe('higgsfieldAdapter.extract — responses it does not care about', () => {
  it('returns null for a /fnf/user profile response', () => {
    expect(higgsfieldAdapter.extract(asResponse(userProfile))).toBeNull();
  });

  it('returns null for a GET /fnf/jobs/{id} status poll (same prefix, not a generate)', () => {
    expect(higgsfieldAdapter.extract(asResponse(jobStatusPoll))).toBeNull();
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

  it('returns null for POST /fnf/jobs/status-batch even when the body looks generate-shaped', () => {
    const statusBatch: CapturedResponse = {
      url: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/status-batch',
      method: 'POST',
      status: 200,
      body: { job_sets: [{ id: 'js_1', cost: 100, params: { prompt: 'x' }, jobs: [] }] },
    };
    expect(higgsfieldAdapter.extract(statusBatch)).toBeNull();
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
});

describe('extractUsage routes a Higgsfield generate to the higgsfield adapter', () => {
  it('tags the paid image usage as tool "higgsfield"', () => {
    const result = extractUsage(asResponse(paidImage));
    expect(result?.tool).toBe('higgsfield');
    expect(result?.usage.cost).toBe(100);
  });
});
