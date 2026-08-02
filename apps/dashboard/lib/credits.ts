import type { RefundState } from '@token-tracker/shared';

/**
 * Displayed credits = internal cost ÷ 100, two-decimal (ADR-0005). Presentation
 * only — `GenerationEvent.cost` stays the internal unit as captured. This is the
 * single display helper the ADR calls for, not scattered math.
 */
export function toCredits(internalCost: number): string {
  return (internalCost / 100).toFixed(2);
}

/**
 * Net internal cost of one generation: charged `cost` minus any refunded amount.
 * Refunds net out of usage, they never delete history (AGENTS.md §6), so a
 * fully-refunded generation nets to 0. Mirrors the Convex `eventNet` roll-up math
 * (`packages/convex/convex/rollups.ts`) on the gallery's projection, so the
 * dashboard's tray/ledger totals agree with the backend roll-ups. Aggregations
 * must sum this, never the raw `cost`, or a refunded generation overstates usage.
 */
export function netCost(cost: number, refund: RefundState): number {
  return cost - (refund.kind === 'refunded' ? refund.amount : 0);
}
