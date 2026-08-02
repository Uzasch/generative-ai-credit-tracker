import { describe, expect, it } from 'vitest';
import type { AnomalyEvidence } from './anomaly';
import type { JobOutcome, RefundState } from './index';
import { collectAnomalyRefs, isEventFlagged, lifecycleStatus } from './lifecycle';

const NONE: RefundState = { kind: 'none' };

describe('lifecycleStatus', () => {
  it('is tracked when the event has no jobs yet', () => {
    // The charge was captured (#3) but no job outcome has been observed.
    expect(lifecycleStatus({ jobs: [], refund: NONE, hasAnomaly: false })).toBe('tracked');
  });

  it('is generating while any job is queued or in_progress', () => {
    const jobs: JobOutcome[] = [
      { jobId: 'a', status: 'completed', mediaUrl: 'https://cdn/a.png' },
      { jobId: 'b', status: 'in_progress' },
    ];
    expect(lifecycleStatus({ jobs, refund: NONE, hasAnomaly: false })).toBe('generating');
    expect(
      lifecycleStatus({
        jobs: [{ status: 'queued' }],
        refund: NONE,
        hasAnomaly: false,
      }),
    ).toBe('generating');
  });

  it('is generated when every job reached a terminal state with no refund', () => {
    const jobs: JobOutcome[] = [{ jobId: 'a', status: 'completed', mediaUrl: 'https://cdn/a.png' }];
    expect(lifecycleStatus({ jobs, refund: NONE, hasAnomaly: false })).toBe('generated');
  });

  it('is refunded when a reversal landed — outranks the job-derived state', () => {
    // A single nsfw job drives a full refund (#17); net usage is 0. The refunded
    // terminal wins over `generated`, so the row never understates the reversal.
    const jobs: JobOutcome[] = [{ jobId: 'a', status: 'nsfw' }];
    const refund: RefundState = { kind: 'refunded', amount: 1200, at: 5 };
    expect(lifecycleStatus({ jobs, refund, hasAnomaly: false })).toBe('refunded');
  });

  it('is flagged whenever an anomaly references the event — highest precedence', () => {
    // Even a completed, refunded generation surfaces as flagged when an anomaly
    // (e.g. a cost-mismatch) references it: the human signal outranks the outcome.
    const jobs: JobOutcome[] = [{ jobId: 'a', status: 'completed', mediaUrl: 'https://cdn/a.png' }];
    const refund: RefundState = { kind: 'refunded', amount: 100, at: 5 };
    expect(lifecycleStatus({ jobs, refund, hasAnomaly: true })).toBe('flagged');
    expect(lifecycleStatus({ jobs: [], refund: NONE, hasAnomaly: true })).toBe('flagged');
  });
});

describe('collectAnomalyRefs / isEventFlagged', () => {
  const costMismatch: AnomalyEvidence = {
    kind: 'cost-mismatch',
    displayedCost: 12,
    responseCost: 1200,
    expectedCost: 1200,
  };
  const unknownStatus: AnomalyEvidence = {
    kind: 'unknown-status',
    jobId: 'job_9',
    rawStatus: 'weird',
    sourceUrl: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/status-batch',
  };
  const clickNoRequest: AnomalyEvidence = {
    kind: 'click-no-request',
    host: 'higgsfield.ai',
    clickedAt: 1,
    windowMs: 4000,
  };

  it('links a cost-mismatch anomaly to its event by toolRef', () => {
    const refs = collectAnomalyRefs([{ toolRef: 'jobset_1', evidence: costMismatch }]);
    expect(isEventFlagged({ toolRef: 'jobset_1', jobs: [] }, refs)).toBe(true);
    expect(isEventFlagged({ toolRef: 'jobset_2', jobs: [] }, refs)).toBe(false);
  });

  it('links an unknown-status anomaly to its event by job id (it carries no toolRef)', () => {
    const refs = collectAnomalyRefs([{ evidence: unknownStatus }]);
    expect(refs.toolRefs.size).toBe(0);
    expect(isEventFlagged({ toolRef: 'jobset_1', jobs: [{ jobId: 'job_9' }] }, refs)).toBe(true);
    expect(isEventFlagged({ toolRef: 'jobset_1', jobs: [{ jobId: 'job_1' }] }, refs)).toBe(false);
  });

  it('a raw click-no-request anomaly references no event (no toolRef, no jobId)', () => {
    const refs = collectAnomalyRefs([{ evidence: clickNoRequest }]);
    expect(refs.toolRefs.size).toBe(0);
    expect(refs.jobIds.size).toBe(0);
    expect(isEventFlagged({ toolRef: 'jobset_1', jobs: [{ jobId: 'job_9' }] }, refs)).toBe(false);
  });

  it('an event with no toolRef is never matched by toolRef alone', () => {
    const refs = collectAnomalyRefs([{ toolRef: 'jobset_1', evidence: costMismatch }]);
    expect(isEventFlagged({ jobs: [] }, refs)).toBe(false);
  });
});
