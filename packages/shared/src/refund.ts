import { type JobStatus, type RefundState, isFailureStatus } from './index';

/**
 * Refund-decision logic for the Higgsfield adapter, derived from the first
 * captured refund (.scratch/higgsfield-tracking/findings/refund-signal-nsfw.md).
 *
 * A generation whose job reaches a non-`completed` terminal status (e.g. `nsfw`)
 * was fully refunded by the tool. Detection is deterministic — no LLM in the
 * billing path (ADR-0002) — and splits into two independent signals:
 *
 * 1. the **job status** decides *that* a refund happened and its amount (the full
 *    job-set `cost`), via {@link refundForStatus}; and
 * 2. the wallet `subscription_balance` **delta** independently cross-checks that
 *    amount, via {@link crossCheckRefund} — a disagreement is a flagged anomaly,
 *    never silently trusted.
 *
 * Both functions are pure (no I/O, no clock) so the caller supplies `at`, and
 * both stay agnostic of persistence — a refund is a state transition on the
 * original event, never a delete (AGENTS.md §6).
 */

/** The confirmed-reversal arm of {@link RefundState}: its amount and when it landed. */
export type Refunded = Extract<RefundState, { kind: 'refunded' }>;

/**
 * Evidence that the independent wallet cross-check disagreed with the amount the
 * status rule derived. Recorded as a Flagged anomaly (CONTEXT.md, issue #8) —
 * input to the Discovery agent (ADR-0003) — rather than silently overwriting the
 * refunded amount, because a probabilistic guess must never enter the billing
 * path (ADR-0002).
 */
export type RefundMismatch = {
  /** Why the runtime could not confidently reconcile the refund. */
  reason: string;
  /** The full job-set cost the non-`completed` terminal rule expected refunded. */
  statusAmount: number;
  /** The credits the wallet `subscription_balance` actually returned. */
  walletAmount: number;
};

/**
 * Status-driven refund decision (finding rule 2). A non-`completed` terminal job
 * status means the tool refunded the full job-set `cost`, so the event
 * transitions to `refunded { amount: cost, at }` and its net usage becomes 0
 * (#6). A `completed` or still-running status yields `null` — no transition, the
 * charge stands.
 *
 * `at` is the time the refund is attributed to; the wallet refund lands a few
 * seconds *after* the terminal status (finding rule 4), so the caller passes the
 * best time it has (the terminal-status observation, or the wallet delta's own
 * timestamp once that arrives).
 */
export function refundForStatus(status: JobStatus, cost: number, at: number): Refunded | null {
  if (!isFailureStatus(status)) return null;
  return { kind: 'refunded', amount: cost, at };
}

/**
 * Independent wallet cross-check (finding rule 3). The wallet
 * `subscription_balance` returns to its pre-charge level by exactly the job-set
 * `cost`; comparing that observed delta against the status-derived refund amount
 * confirms it without trusting the status alone. Amounts are internal credit
 * units (integers, ADR-0005), so the comparison is exact — no tolerance.
 *
 * Agreement returns `null` (confirmed). Disagreement returns a
 * {@link RefundMismatch} the caller flags for the Discovery agent; the amount is
 * never silently changed to whatever the wallet showed (ADR-0002).
 */
export function crossCheckRefund(statusAmount: number, walletDelta: number): RefundMismatch | null {
  if (walletDelta === statusAmount) return null;
  return {
    reason:
      'wallet subscription_balance refund delta disagrees with the status-derived job-set cost',
    statusAmount,
    walletAmount: walletDelta,
  };
}

/**
 * Whether a value is a usable refund magnitude: a finite, non-negative number.
 * A refund amount is client-influenced (it originates in captured tool traffic),
 * so it is validated before it can enter the billing path — NaN, ±Infinity, and
 * negatives (which would *inflate* net usage rather than net it out) are refused.
 */
export function isValidRefundAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount >= 0;
}

/**
 * Assert a refund amount is a finite, non-negative magnitude, returning it for
 * fluent use at a write boundary. Convex field validators are structural and
 * cannot express this predicate, so every mutation that writes a refund amount
 * guards it here (see `packages/convex/convex/events.ts`).
 */
export function assertRefundAmount(amount: number): number {
  if (!isValidRefundAmount(amount)) {
    throw new Error(`refund amount must be a finite, non-negative number (got ${amount})`);
  }
  return amount;
}
