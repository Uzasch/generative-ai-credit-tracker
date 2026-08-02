import type { Doc } from './_generated/dataModel';

/**
 * Net-usage math for roll-ups. Pure and side-effect free so it is unit-tested
 * directly (AGENTS.md §9) and shared by every roll-up query in `events.ts`.
 *
 * Refunds net out, they never delete history (AGENTS.md §6): a refunded event
 * still contributes its charged `cost`, reduced by the refunded `amount`.
 */

/** The parts of an event roll-up math needs: what it charged and whether it was refunded. */
type Costed = Pick<Doc<'events'>, 'cost' | 'refund'>;

/** Net cost of a single event: charged cost minus any refunded amount. */
export function eventNet(event: Costed): number {
  const refunded = event.refund.kind === 'refunded' ? event.refund.amount : 0;
  return event.cost - refunded;
}

/** Net usage across a set of events (charges minus refunds). */
export function sumNet(events: readonly Costed[]): number {
  return events.reduce((total, event) => total + eventNet(event), 0);
}
