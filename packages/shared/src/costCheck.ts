/**
 * Displayed-cost cross-check (#13, guardrail for ADR-0005).
 *
 * Higgsfield renders a user-facing "credit" figure on the Generate button that is
 * the internal `job_sets[].cost` unit divided by 100 (ADR-0005). The network
 * capture is the authoritative, billed Cost; this module never changes it. It only
 * compares the *displayed* credits (read from the button DOM, #13) against the
 * captured response cost and reports whether the ÷100 rule held — so a model that
 * ever violates it is caught instead of silently mis-displayed.
 *
 * Pure and I/O-free so it is unit-testable; the extension background feeds it the
 * two numbers and turns a `mismatch` into a `cost-mismatch` Flagged anomaly.
 */

/**
 * Internal cost units per one displayed credit (ADR-0005). The dashboard's
 * `toCredits` display helper divides by this same factor; kept here as the shared
 * constant the cross-check reconciles against, not scattered math.
 */
export const INTERNAL_UNITS_PER_CREDIT = 100;

/**
 * Outcome of comparing the button's displayed credits against the response cost.
 * `match` when ADR-0005's ÷100 rule held; `mismatch` carries both numbers (plus
 * the cost the display implied) as evidence for the Flagged anomaly.
 */
export type CostReconciliation =
  | { kind: 'match' }
  | { kind: 'mismatch'; displayedCost: number; responseCost: number; expectedCost: number };

/**
 * Reconcile the credits shown on the Generate button (`displayedCost`) with the
 * authoritative internal `responseCost` from `job_sets[].cost`. Under ADR-0005 the
 * display is `responseCost ÷ 100`, so the two agree iff
 * `round(displayedCost × 100) === responseCost` (rounding absorbs the two-decimal
 * display, e.g. 1.5 credits ⇒ 150). Any disagreement is a `mismatch`.
 *
 * Non-finite inputs never produce a mismatch: a garbage or unreadable figure is an
 * absent cross-check, not evidence the ratio broke — the runtime degrades to "no
 * cross-check" rather than false-flagging a real generation (#13 acceptance).
 */
export function reconcileDisplayedCost(
  displayedCost: number,
  responseCost: number,
): CostReconciliation {
  if (!Number.isFinite(displayedCost) || !Number.isFinite(responseCost)) {
    return { kind: 'match' };
  }
  const expectedCost = Math.round(displayedCost * INTERNAL_UNITS_PER_CREDIT);
  if (expectedCost === responseCost) return { kind: 'match' };
  return { kind: 'mismatch', displayedCost, responseCost, expectedCost };
}
