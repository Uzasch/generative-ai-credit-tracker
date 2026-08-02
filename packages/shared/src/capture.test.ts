import { describe, expect, it } from 'vitest';
import { type RawCaptureContent, isDenylistedCaptureUrl, isDuplicateCapture } from './capture';

const HOST = 'https://fnf-api-gw.higgsfield.ai';

describe('isDenylistedCaptureUrl', () => {
  it('drops the UI-chatter endpoints measured on the cinema-studio session', () => {
    const denied = [
      '/fnf/folders',
      '/fnf/folders/accessible',
      '/fnf/tours',
      '/fnf/banner',
      '/fnf/banners',
      '/fnf/referral-campaigns/active',
      '/fnf/feedback/prompt',
      '/fnf/color-presets',
      '/fnf-notification/list',
      '/fnf/workspaces',
      '/fnf/workspaces/ws_123/members',
      '/fnf/soul/presets/list',
    ];
    for (const path of denied) {
      expect(isDenylistedCaptureUrl(`${HOST}${path}`)).toBe(true);
    }
  });

  it('keeps generation traffic and the identity/wallet cross-check endpoints', () => {
    const kept = [
      '/fnf/jobs/soul', // POST generate
      '/fnf/jobs/v2/soul', // POST generate (v2)
      '/fnf/jobs/job_abc123', // GET single status poll
      '/fnf/jobs/status-batch', // POST batch status poll
      '/fnf/user', // identity — kept for #17
      '/fnf/workspaces/wallet', // wallet balance — kept for #17
      '/fnf/workspaces/wallet/transactions', // wallet sub-resource
    ];
    for (const path of kept) {
      expect(isDenylistedCaptureUrl(`${HOST}${path}`)).toBe(false);
    }
  });

  it('keeps an unparseable or unrecognised URL — ADR-0001 breadth is the default', () => {
    expect(isDenylistedCaptureUrl('not a url')).toBe(false);
    expect(isDenylistedCaptureUrl(`${HOST}/fnf/something-new`)).toBe(false);
  });
});

/** A single status poll for a job that is still in progress. */
function poll(overrides: Partial<RawCaptureContent> = {}): RawCaptureContent {
  return {
    method: 'GET',
    url: `${HOST}/fnf/jobs/job_abc`,
    status: 200,
    requestBody: null,
    responseBody: '{"id":"job_abc","status":"in_progress"}',
    ...overrides,
  };
}

describe('isDuplicateCapture', () => {
  it('collapses an identical consecutive poll', () => {
    expect(isDuplicateCapture(poll(), poll())).toBe(true);
  });

  it('retains a poll whose job status transitioned', () => {
    const completed = poll({
      responseBody: '{"id":"job_abc","status":"completed"}',
    });
    expect(isDuplicateCapture(poll(), completed)).toBe(false);
  });

  it('retains a poll to a different job (different URL)', () => {
    const other = poll({ url: `${HOST}/fnf/jobs/job_xyz` });
    expect(isDuplicateCapture(poll(), other)).toBe(false);
  });

  it('retains a differing HTTP status or request body', () => {
    expect(isDuplicateCapture(poll(), poll({ status: 500 }))).toBe(false);
    expect(isDuplicateCapture(poll(), poll({ requestBody: '{"ids":["a"]}' }))).toBe(false);
  });
});
