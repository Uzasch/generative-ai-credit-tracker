import { describe, expect, it } from 'vitest';
import captureFixture from './__fixtures__/cinema-studio-captures.json';
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

describe('retention rules replayed over the real cinema-studio HAR', () => {
  // Real 62-request `fnf-api-gw` capture from ADR-0007's measured cinema-studio
  // session (input/higgfield/image/cinema-studio/cinemastudio.har), CORS-preflight
  // OPTIONS and non-fnf hosts dropped (the fetch probe never sees them) and bodies
  // sha256-hashed — PII-free but byte-equality preserving, which is all the two
  // rules inspect. This pins the *measured* reduction, replacing ADR-0007's
  // projected "~8 rows survive": that projection assumed only generation rows are
  // kept, but the denylist deliberately keeps unrecognised endpoints (ADR-0001
  // breadth), so 22 survive — the real number this test now guards.
  const captures: RawCaptureContent[] = captureFixture.captures.map((c) => ({
    method: c.method,
    url: c.url,
    status: c.status,
    requestBody: c.requestBody,
    responseBody: c.responseBody,
  }));

  /**
   * Mirror `rawCaptures.record`'s retention pipeline: drop denylisted URLs, then
   * drop a byte-identical repeat of the most recent *retained* capture for the
   * same URL. Session timestamps span minutes, so the mutation's de-dup recency
   * window (a mutation-layer concern) never fires here — the two shared rules
   * fully determine what is kept.
   */
  function retain(seq: readonly RawCaptureContent[]): RawCaptureContent[] {
    const kept: RawCaptureContent[] = [];
    for (const c of seq) {
      if (isDenylistedCaptureUrl(c.url)) continue;
      const prior = [...kept].reverse().find((k) => k.url === c.url);
      if (prior && isDuplicateCapture(prior, c)) continue;
      kept.push(c);
    }
    return kept;
  }

  it('reduces the 62 observed captures to the 22 that carry signal', () => {
    expect(captures).toHaveLength(62);
    expect(retain(captures)).toHaveLength(22);
  });

  it('keeps every generation / cross-check request and drops the UI chatter', () => {
    const paths = retain(captures).map((c) => new URL(c.url).pathname);
    // Generation + refund/identity cross-check endpoints survive.
    expect(paths).toContain('/fnf/jobs/v2/soul_cinema_studio'); // the generate POST
    expect(paths).toContain('/fnf/jobs/status-batch'); // batch status poll
    expect(paths).toContain('/fnf/workspaces/wallet'); // wallet cross-check (#17)
    expect(paths).toContain('/fnf/user'); // identity
    // Both polled job ids survive (each status transition is a distinct row).
    expect(paths.some((p) => p.startsWith('/fnf/jobs/b40457f7'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/fnf/jobs/b30c24cf'))).toBe(true);
    // Denylisted noise is gone entirely.
    for (const noise of [
      '/fnf/folders',
      '/fnf/tours',
      '/fnf/banner',
      '/fnf-notification',
      '/fnf/referral-campaigns',
      '/fnf/feedback',
      '/fnf/color-presets',
    ]) {
      expect(paths.some((p) => p.startsWith(noise))).toBe(false);
    }
  });

  it('collapses only byte-identical repeats — job-status transitions are all kept', () => {
    // De-dup over the raw sequence (before the denylist) fires on the six
    // byte-identical consecutive repeats in the session — all of them UI chatter
    // the denylist also removes, which is why the pipeline nets zero *extra*
    // de-dup drops here. The three status polls per job are real transitions
    // (queued → in_progress → completed), so none collapse.
    let collapsed = 0;
    const kept: RawCaptureContent[] = [];
    for (const c of captures) {
      const prior = [...kept].reverse().find((k) => k.url === c.url);
      if (prior && isDuplicateCapture(prior, c)) {
        collapsed++;
        continue;
      }
      kept.push(c);
    }
    expect(collapsed).toBe(6);
  });
});
