import { readDisplayedCost } from '@/lib/displayedCost';
import { GENERATE_CLICK_SOURCE, TRIPWIRE_MATCHES } from '@/lib/messaging';
import { matchesGenerateLabel } from '@/lib/tripwire';

/**
 * ISOLATED-world click tripwire (#8, ADR-0002). Observes Generate-button clicks
 * and reports each to the background, which correlates it against captured
 * generate requests and raises a `click-no-request` Flagged anomaly when a click
 * has no matching request within the window — the canonical "cancel a generation
 * after clicking Generate" case (CONTEXT.md).
 *
 * Observe-only (AGENTS.md §5): a passive, capture-phase click listener that reads
 * the clicked control's accessible label and nothing else. It never blocks the
 * click, calls `preventDefault`, mutates the DOM, or injects page CSS. Running in
 * the ISOLATED world it has `browser.runtime`, so it messages the background
 * directly — no MAIN-world bridge, and no page-shared surface to trust.
 *
 * It also reads the button's displayed credit figure at click time (#13) and
 * reports it on the same message; the background reconciles it against the
 * response cost and raises a `cost-mismatch` anomaly in the same table. Reading is
 * observe-only and total (never throws into the page); an unreadable figure is
 * simply omitted, so the cross-check degrades gracefully.
 */
export default defineContentScript({
  // Only tools whose adapter recognises generate requests, so a click can be
  // correlated against its real request (see TRIPWIRE_MATCHES).
  matches: TRIPWIRE_MATCHES,
  main() {
    document.addEventListener(
      'click',
      (event) => {
        const button = generateButton(event.target);
        if (button === null) return;
        // Read the button's displayed credits (#13). Null when the DOM exposes no
        // figure — the report is still sent (for #8's click↔request correlation),
        // just without a cross-check value.
        const displayedCost = readDisplayedCost(button);
        browser.runtime
          .sendMessage({
            source: GENERATE_CLICK_SOURCE,
            payload: {
              host: window.location.host,
              clickedAt: Date.now(),
              ...(displayedCost !== null ? { displayedCost } : {}),
            },
          })
          .catch(() => {
            // Background may be asleep; the tripwire is best-effort.
          });
      },
      // Passive + capture: we only observe, never intercept or preventDefault.
      { capture: true, passive: true },
    );
  },
});

/**
 * If the click landed on (or inside) a Generate control, return that button
 * element; otherwise null. Walks up at most a few ancestors from the event target
 * to the nearest button-like element and reads its aria-label/text — the minimal
 * DOM read needed to recognise the click, nothing more (AGENTS.md §5). Returning
 * the element (not just its label) lets the caller read its displayed cost (#13).
 */
function generateButton(target: EventTarget | null): Element | null {
  let el = target instanceof Element ? target : null;
  for (let depth = 0; el !== null && depth < 5; depth++, el = el.parentElement) {
    if (!isButtonLike(el)) continue;
    // Stop at the nearest button-like ancestor: if it isn't Generate, don't keep
    // climbing (a Generate button nested in a larger clickable region is rare and
    // out of scope for this minimal tripwire).
    return matchesGenerateLabel(accessibleLabel(el)) ? el : null;
  }
  return null;
}

function isButtonLike(el: Element): boolean {
  return el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
}

/** Accessible label: the element's aria-label, else its trimmed text content. */
function accessibleLabel(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria !== null && aria.trim().length > 0) return aria.trim();
  return (el.textContent ?? '').trim();
}
