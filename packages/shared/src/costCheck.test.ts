import { describe, expect, it } from 'vitest';
import { INTERNAL_UNITS_PER_CREDIT, reconcileDisplayedCost } from './costCheck';

describe('reconcileDisplayedCost', () => {
  it('matches when the button credits are exactly response cost ÷ 100 (ADR-0005)', () => {
    // The captured real generation: cost 100 rendered as "1 credit" (ADR-0005).
    expect(reconcileDisplayedCost(1, 100)).toEqual({ kind: 'match' });
    expect(reconcileDisplayedCost(5, 500)).toEqual({ kind: 'match' });
    expect(reconcileDisplayedCost(7.5, 750)).toEqual({ kind: 'match' });
  });

  it('matches a free generation (0 credits ⇔ 0 cost)', () => {
    expect(reconcileDisplayedCost(0, 0)).toEqual({ kind: 'match' });
  });

  it('flags a mismatch when the ÷100 rule breaks, carrying both numbers', () => {
    // A model shows "1 credit" but the response billed 250 internal units — the
    // display ratio broke for it (the guardrail case ADR-0005 warns about).
    expect(reconcileDisplayedCost(1, 250)).toEqual({
      kind: 'mismatch',
      displayedCost: 1,
      responseCost: 250,
      expectedCost: 100,
    });
  });

  it('rounds the two-decimal display before comparing', () => {
    // 1.5 credits × 100 = 150 — the rounding absorbs the two-decimal display so a
    // legitimate fractional credit is not false-flagged.
    expect(reconcileDisplayedCost(1.5, 150)).toEqual({ kind: 'match' });
    // …but a real divergence at the same scale is still caught.
    expect(reconcileDisplayedCost(1.5, 160).kind).toBe('mismatch');
  });

  it('never flags on a non-finite figure — an absent cross-check, not a mismatch', () => {
    // A NaN/Infinity displayed value means the button was unreadable; degrade to
    // "no cross-check" rather than false-flag a real generation (#13 acceptance).
    expect(reconcileDisplayedCost(Number.NaN, 100)).toEqual({ kind: 'match' });
    expect(reconcileDisplayedCost(1, Number.POSITIVE_INFINITY)).toEqual({ kind: 'match' });
  });

  it('exposes the ÷100 factor as the shared constant', () => {
    expect(INTERNAL_UNITS_PER_CREDIT).toBe(100);
  });
});
