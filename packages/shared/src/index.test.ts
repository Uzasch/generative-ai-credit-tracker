import { describe, expect, it } from 'vitest';
import { FAILURE_STATUSES, JOB_STATUSES, isFailureStatus, isJobStatus } from './index';

describe('job status model', () => {
  it("carries 'nsfw' as a recognised terminal status", () => {
    // The content-safety rejection Higgsfield actually produced
    // (.scratch/higgsfield-tracking/findings/refund-signal-nsfw.md) must no
    // longer fall through the unknown-status path.
    expect(JOB_STATUSES).toContain('nsfw');
    expect(isJobStatus('nsfw')).toBe(true);
  });

  it('every FAILURE_STATUS is also a JobStatus', () => {
    for (const status of FAILURE_STATUSES) {
      expect(isJobStatus(status)).toBe(true);
    }
  });
});

describe('isFailureStatus', () => {
  it('accepts the non-completed terminal failures', () => {
    expect(isFailureStatus('failed')).toBe(true);
    expect(isFailureStatus('nsfw')).toBe(true);
  });

  it('rejects success and non-terminal statuses', () => {
    expect(isFailureStatus('completed')).toBe(false);
    expect(isFailureStatus('queued')).toBe(false);
    expect(isFailureStatus('in_progress')).toBe(false);
  });

  it('rejects unrecognised and non-string values', () => {
    expect(isFailureStatus('cancelled')).toBe(false);
    expect(isFailureStatus(undefined)).toBe(false);
    expect(isFailureStatus(2)).toBe(false);
  });
});
