import { describe, expect, it } from 'vitest';
import type { JobStatus } from './index';
import {
  assertRefundAmount,
  crossCheckRefund,
  isValidRefundAmount,
  refundForStatus,
} from './refund';

// The captured `veo3_1_lite` lifecycle this logic is derived from
// (.scratch/higgsfield-tracking/findings/refund-signal-nsfw.md): one job set,
// one job, charged the full 1200 then fully refunded after a content-safety
// rejection.
const COST = 1200;
const NSFW_AT = 1_000; // terminal `nsfw` status observed (ms epoch, arbitrary)
const REFUND_AT = 1_009; // wallet refund landed ~9s later (finding rule 4)

describe('refundForStatus — the captured nsfw lifecycle (queued → in_progress → nsfw)', () => {
  it('does not refund while the job is still queued or in progress', () => {
    // The charge stands until a terminal outcome is known — the tool has not
    // reversed anything yet.
    expect(refundForStatus('queued', COST, NSFW_AT)).toBeNull();
    expect(refundForStatus('in_progress', COST, NSFW_AT)).toBeNull();
  });

  it('refunds the full job-set cost when the job terminates non-`completed` (nsfw)', () => {
    // finding rule 2: a non-`completed` terminal ⇒ the full cost was refunded.
    expect(refundForStatus('nsfw', COST, NSFW_AT)).toEqual({
      kind: 'refunded',
      amount: COST,
      at: NSFW_AT,
    });
  });

  it('refunds on the generic terminal-failure bucket too, not just nsfw', () => {
    expect(refundForStatus('failed', 500, NSFW_AT)).toEqual({
      kind: 'refunded',
      amount: 500,
      at: NSFW_AT,
    });
  });

  it('never refunds a successful (`completed`) generation', () => {
    // The success terminal keeps its charge; net usage is unchanged.
    expect(refundForStatus('completed', COST, NSFW_AT)).toBeNull();
  });

  it('carries a free generation (cost 0) as a 0-amount refund, still netting out', () => {
    expect(refundForStatus('nsfw', 0, NSFW_AT)).toEqual({
      kind: 'refunded',
      amount: 0,
      at: NSFW_AT,
    });
  });
});

describe('crossCheckRefund — independent wallet subscription_balance cross-check', () => {
  it('confirms the refund when the wallet delta equals the status-derived cost', () => {
    // Balance returned to baseline by exactly 1200 (finding balance evidence).
    expect(crossCheckRefund(COST, 1200)).toBeNull();
  });

  it('flags a mismatch when the wallet returned a different amount (never silently trusted)', () => {
    // ADR-0002: the discrepancy is recorded as evidence, not reconciled to a guess.
    expect(crossCheckRefund(COST, 1100)).toEqual({
      reason:
        'wallet subscription_balance refund delta disagrees with the status-derived job-set cost',
      statusAmount: COST,
      walletAmount: 1100,
    });
  });

  it('flags a wallet that shows no refund at all', () => {
    const mismatch = crossCheckRefund(COST, 0);
    expect(mismatch).not.toBeNull();
    expect(mismatch?.walletAmount).toBe(0);
  });
});

describe('the full nsfw lifecycle end to end (queued → in_progress → nsfw → refund)', () => {
  it('nets the event to 0 and confirms it against the lagging wallet refund', () => {
    // Statuses stream in from passive polls; only the terminal one transitions.
    const lifecycle: JobStatus[] = ['queued', 'in_progress', 'nsfw'];
    let refund = lifecycle
      .map((status) => refundForStatus(status, COST, NSFW_AT))
      .reduce<ReturnType<typeof refundForStatus>>((acc, next) => next ?? acc, null);

    expect(refund).toEqual({ kind: 'refunded', amount: COST, at: NSFW_AT });

    // ~9s later the wallet refund is observed and cross-checks clean.
    const mismatch = refund ? crossCheckRefund(refund.amount, 1200) : null;
    expect(mismatch).toBeNull();

    // The refund lands with the wallet's own timestamp once confirmed.
    if (refund) refund = { ...refund, at: REFUND_AT };
    const net = COST - (refund?.amount ?? 0);
    expect(net).toBe(0);
  });
});

describe('isValidRefundAmount / assertRefundAmount — bound the client-influenced magnitude', () => {
  it('accepts finite non-negative amounts (including a free 0-cost refund)', () => {
    expect(isValidRefundAmount(0)).toBe(true);
    expect(isValidRefundAmount(1200)).toBe(true);
    expect(assertRefundAmount(1200)).toBe(1200);
  });

  it('rejects NaN, ±Infinity, and negatives', () => {
    expect(isValidRefundAmount(Number.NaN)).toBe(false);
    expect(isValidRefundAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidRefundAmount(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(isValidRefundAmount(-1)).toBe(false);

    expect(() => assertRefundAmount(Number.NaN)).toThrow(/finite, non-negative/);
    expect(() => assertRefundAmount(Number.POSITIVE_INFINITY)).toThrow(/finite, non-negative/);
    expect(() => assertRefundAmount(-1)).toThrow(/finite, non-negative/);
  });
});
