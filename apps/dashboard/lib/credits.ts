/**
 * Displayed credits = internal cost ÷ 100, two-decimal (ADR-0005). Presentation
 * only — `GenerationEvent.cost` stays the internal unit as captured. This is the
 * single display helper the ADR calls for, not scattered math.
 */
export function toCredits(internalCost: number): string {
  return (internalCost / 100).toFixed(2);
}
