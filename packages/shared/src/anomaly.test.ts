import { describe, expect, it } from 'vitest';
import { type AnomalyEvidence, isAnomalyKind } from './anomaly';

describe('isAnomalyKind', () => {
  it('accepts every shipped kind (#8 + #13)', () => {
    expect(isAnomalyKind('click-no-request')).toBe(true);
    expect(isAnomalyKind('unknown-status')).toBe(true);
    // `cost-mismatch` is now a real emitted kind (#13 displayed-cost cross-check).
    expect(isAnomalyKind('cost-mismatch')).toBe(true);
  });

  it('rejects unknown kinds and non-strings', () => {
    expect(isAnomalyKind('quarantined')).toBe(false);
    expect(isAnomalyKind('')).toBe(false);
    expect(isAnomalyKind(undefined)).toBe(false);
    expect(isAnomalyKind(42)).toBe(false);
  });
});

describe('AnomalyEvidence discriminates on kind', () => {
  it('narrows each arm to its raw-evidence fields', () => {
    const evidence: AnomalyEvidence[] = [
      { kind: 'click-no-request', host: 'higgsfield.ai', clickedAt: 1, windowMs: 4000 },
      {
        kind: 'unknown-status',
        jobId: 'job_1',
        rawStatus: 'quarantined',
        sourceUrl: 'https://fnf-api-gw.higgsfield.ai/fnf/jobs/job_1',
      },
      { kind: 'cost-mismatch', displayedCost: 1, responseCost: 250, expectedCost: 100 },
    ];
    // The discriminant lets a consumer pull kind-specific evidence without casts.
    for (const e of evidence) {
      if (e.kind === 'unknown-status') expect(e.rawStatus).toBe('quarantined');
      else if (e.kind === 'cost-mismatch') expect(e.responseCost).toBe(250);
      else expect(e.host).toBe('higgsfield.ai');
    }
  });
});
