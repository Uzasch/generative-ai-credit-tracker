/**
 * Displayed-cost capture (#13, guardrail for ADR-0005). The ISOLATED-world click
 * tripwire reads the credit figure rendered on the Generate button at click time;
 * the background correlates it with the authoritative response cost and flags a
 * `cost-mismatch` when the ÷100 display rule broke (see `reconcileDisplayedCost`
 * in @token-tracker/shared). The button figure is a cross-check only — it never
 * becomes the billed Cost (ADR-0005).
 *
 * The DOM read is deliberately minimal and observe-only (AGENTS.md §5): it reads
 * the button's own text and nothing else, and never throws into the page. It does
 * NOT depend on hashed class names — Higgsfield is a React app whose class names
 * churn — so the whole selector strategy is one regex over the button's text,
 * centralised here so a UI change is a one-place fix (#13 acceptance).
 */

/** A credit figure parsed off the Generate button, e.g. "1 credit" ⇒ value 1. */
export type DisplayedCost = {
  /** The numeric credits shown (the ÷100 figure, ADR-0005). */
  value: number;
  /** The unit token; only 'credit' is recognised today. */
  unit: 'credit';
};

/**
 * The centralised selector strategy: a credit figure is a number immediately
 * followed by the word "credit"/"credits" anywhere in the button's text. Requiring
 * the unit word avoids mistaking an unrelated number (e.g. a "(100)" internal cost
 * or a queue count) for the displayed credits. Tolerant of a two-decimal display.
 */
const CREDIT_FIGURE = /(\d+(?:\.\d+)?)\s*credits?\b/i;

/**
 * Parse the Generate button's text into a {@link DisplayedCost}, or null when no
 * credit figure is present or the text is missing. Pure and total — never throws —
 * so an unexpected/renamed DOM simply yields null (a degraded cross-check, never a
 * crash into the page, #13 acceptance).
 */
export function parseDisplayedCost(raw: string | null | undefined): DisplayedCost | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(CREDIT_FIGURE);
  const figure = match?.[1];
  if (figure === undefined) return null;
  const value = Number.parseFloat(figure);
  if (!Number.isFinite(value)) return null;
  return { value, unit: 'credit' };
}

/**
 * Read the displayed cost off a Generate button element (its `textContent`), or
 * null. Observe-only and defensive: any DOM access failure degrades to null and is
 * never allowed to throw into the page (AGENTS.md §5). Only the button's own text
 * is read — no secrets or unrelated DOM content are captured (#13 acceptance).
 */
export function readDisplayedCost(button: Element): DisplayedCost | null {
  try {
    return parseDisplayedCost(button.textContent);
  } catch {
    return null;
  }
}

/** Type guard for a {@link DisplayedCost} arriving over the messaging boundary. */
export function isDisplayedCost(value: unknown): value is DisplayedCost {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as { value?: unknown; unit?: unknown };
  return typeof d.value === 'number' && Number.isFinite(d.value) && d.unit === 'credit';
}

/** A displayed cost observed at click, awaiting its generate response to reconcile. */
type PendingDisplayedCost = {
  /** Credits shown on the button when the click fired. */
  value: number;
  /** When the click fired, client ms epoch. */
  clickedAt: number;
  /**
   * Browser tab the click came from. Correlation is scoped to it so a generate
   * response in one tab can't consume the displayed cost of a click in another.
   */
  tabId?: number;
};

/**
 * Pairs a Generate button's displayed cost (captured at click, before the request)
 * with the authoritative cost on the generate *response* (captured after), by tab
 * and timing. The two travel through different content-script paths — the click
 * tripwire and the fetch-patch capture — so this buffers the click's figure until
 * its response lands.
 *
 * Pure correlation core (no DOM, no timers, no I/O) so it is unit-testable; the
 * background feeds it clicks and generate responses and turns a matched pair into
 * a `reconcileDisplayedCost` check. Separate from the click↔request correlator
 * (`tripwire.ts`): that one is consumed by the request-*start* signal (no cost),
 * which fires and removes the click before the cost-bearing response is captured.
 */
export class DisplayedCostCorrelator {
  private readonly pending: PendingDisplayedCost[] = [];

  constructor(
    /** How long after a click a generate response may still be paired with it. */
    private readonly windowMs: number,
    /**
     * Clock-skew tolerance: the click clock (content script) and the response
     * capture clock are independent, so a response can land a hair before its
     * click. Without this slop that skew would miss a genuine pairing.
     */
    private readonly slopMs = 1000,
  ) {}

  /** Buffer a displayed cost read at click time, to be paired with its response. */
  onClick(value: number, clickedAt: number, tabId?: number): void {
    this.pending.push({ value, clickedAt, tabId });
  }

  /**
   * A generate response was captured at `responseAt` in tab `tabId`. Return the
   * displayed cost of the pending click from the SAME tab it belongs to — but ONLY
   * when that pairing is unambiguous: exactly one pending click sits in the window
   * (clicked no more than `windowMs` before, and no more than `slopMs` after, the
   * response). Returns null otherwise, and consumes nothing.
   *
   * Why "exactly one" rather than oldest-first: two generations started rapidly in
   * one tab can have their network responses complete out of order, so
   * response-arrival order no longer identifies which click a response belongs to.
   * Guessing (FIFO) would pair a response with the wrong click and raise a *false*
   * `cost-mismatch`. The cross-check is a best-effort guardrail (the network cost
   * stays primary, #13), so an ambiguous case is skipped, never guessed — a missed
   * cross-check is safe; a false anomaly is not. Stale pendings are pruned here.
   */
  matchResponse(responseAt: number, tabId?: number): number | null {
    this.prune(responseAt);
    const candidates: number[] = [];
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (p === undefined || p.tabId !== tabId) continue;
      const delta = responseAt - p.clickedAt; // > 0: response after click (normal order)
      if (delta <= this.windowMs && delta >= -this.slopMs) candidates.push(i);
    }
    if (candidates.length !== 1) return null;
    const [index] = candidates;
    if (index === undefined) return null;
    const match = this.pending[index];
    if (match === undefined) return null;
    this.pending.splice(index, 1);
    return match.value;
  }

  /** How many displayed costs are still awaiting a response (for tests/inspection). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Drop pendings whose window has fully elapsed by `now` — their response passed. */
  private prune(now: number): void {
    const kept = this.pending.filter((p) => now - p.clickedAt <= this.windowMs);
    this.pending.length = 0;
    this.pending.push(...kept);
  }
}
