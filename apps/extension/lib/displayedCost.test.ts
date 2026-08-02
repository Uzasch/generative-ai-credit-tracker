import { describe, expect, it } from 'vitest';
import { DisplayedCostCorrelator, isDisplayedCost, parseDisplayedCost } from './displayedCost';

describe('parseDisplayedCost', () => {
  it('parses a credit figure into value + unit', () => {
    expect(parseDisplayedCost('1 credit')).toEqual({ value: 1, unit: 'credit' });
    expect(parseDisplayedCost('2 credits')).toEqual({ value: 2, unit: 'credit' });
  });

  it('finds the credit figure embedded in the full button text', () => {
    // The button renders its label and the cost together; the regex pulls the cost
    // out without depending on hashed class names (the centralised strategy, #13).
    expect(parseDisplayedCost('Generate\n1 credit')).toEqual({ value: 1, unit: 'credit' });
    expect(parseDisplayedCost('Generate video · 5 credits')).toEqual({ value: 5, unit: 'credit' });
  });

  it('parses a two-decimal credit figure', () => {
    expect(parseDisplayedCost('7.5 credits')).toEqual({ value: 7.5, unit: 'credit' });
  });

  it('returns null when no credit figure is present (degraded read, never throws)', () => {
    // A bare number with no "credit" unit is NOT treated as a cost — it could be a
    // queue count or an internal "(100)" figure, which would mis-flag (#13).
    expect(parseDisplayedCost('Generate')).toBeNull();
    expect(parseDisplayedCost('Generate (100)')).toBeNull();
    expect(parseDisplayedCost('')).toBeNull();
    expect(parseDisplayedCost(null)).toBeNull();
    expect(parseDisplayedCost(undefined)).toBeNull();
  });
});

describe('isDisplayedCost', () => {
  it('accepts a well-formed displayed cost', () => {
    expect(isDisplayedCost({ value: 1, unit: 'credit' })).toBe(true);
  });

  it('rejects malformed or non-finite shapes off the wire', () => {
    expect(isDisplayedCost({ value: Number.NaN, unit: 'credit' })).toBe(false);
    expect(isDisplayedCost({ value: 1, unit: 'token' })).toBe(false);
    expect(isDisplayedCost({ value: '1', unit: 'credit' })).toBe(false);
    expect(isDisplayedCost(null)).toBe(false);
    expect(isDisplayedCost(1)).toBe(false);
  });
});

describe('DisplayedCostCorrelator', () => {
  const WINDOW = 4500;

  it('pairs a response with the click that preceded it, returning its value', () => {
    const c = new DisplayedCostCorrelator(WINDOW);
    c.onClick(1, 1000);
    // Response captured 2s after the click, in the same (undefined) tab.
    expect(c.matchResponse(3000)).toBe(1);
    expect(c.pendingCount).toBe(0);
  });

  it('returns null when no click is pending (button showed no figure)', () => {
    const c = new DisplayedCostCorrelator(WINDOW);
    expect(c.matchResponse(3000)).toBeNull();
  });

  it('does not pair a response past the click window', () => {
    const c = new DisplayedCostCorrelator(WINDOW);
    c.onClick(1, 1000);
    // Too late: this response belongs to no buffered click, and the stale click is
    // pruned so it can never be mis-paired with a later response.
    expect(c.matchResponse(1000 + WINDOW + 1)).toBeNull();
    expect(c.pendingCount).toBe(0);
  });

  it('never pairs a click that is timestamped after the response', () => {
    const c = new DisplayedCostCorrelator(WINDOW);
    // A later click (e.g. buffered while handleCapture was suspended) must not be
    // paired with this earlier response — same-tab clocks can't run backwards, so
    // pairing it would be a false cost-mismatch (Codex #13).
    c.onClick(3, 5000);
    expect(c.matchResponse(4200)).toBeNull();
    expect(c.pendingCount).toBe(1);
  });

  it("scopes pairing to the tab: a response cannot consume another tab's click", () => {
    const c = new DisplayedCostCorrelator(WINDOW);
    c.onClick(1, 1000, 1);
    // A response in tab 2 must not consume tab 1's buffered displayed cost.
    expect(c.matchResponse(2000, 2)).toBeNull();
    expect(c.pendingCount).toBe(1);
    // The response in tab 1 does pair with it.
    expect(c.matchResponse(2500, 1)).toBe(1);
    expect(c.pendingCount).toBe(0);
  });

  it('skips an ambiguous pairing rather than guessing (no false anomaly)', () => {
    const c = new DisplayedCostCorrelator(WINDOW);
    // Two generations started rapidly in one tab: both clicks sit in the window of
    // the first response, so response-arrival order can't say which it belongs to.
    // FIFO would mis-pair and raise a false cost-mismatch; instead we skip.
    c.onClick(1, 1000);
    c.onClick(5, 1500);
    expect(c.matchResponse(2000)).toBeNull();
    // Nothing was consumed — a wrong guess is never made.
    expect(c.pendingCount).toBe(2);
  });

  it('pairs sequential generations whose windows do not overlap', () => {
    const c = new DisplayedCostCorrelator(WINDOW);
    c.onClick(1, 1000);
    // Its response lands and pairs unambiguously (only one click in range).
    expect(c.matchResponse(2000)).toBe(1);
    // A later, separate generation — the first click is long pruned, so this is
    // again unambiguous.
    c.onClick(5, 20_000);
    expect(c.matchResponse(21_000)).toBe(5);
    expect(c.pendingCount).toBe(0);
  });
});
