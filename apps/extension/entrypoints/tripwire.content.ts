import { GENERATE_CLICK_SOURCE, TOOL_MATCHES } from '@/lib/messaging';
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
 * This ticket observes the click only; the button's displayed cost (and the
 * cost-mismatch anomaly) is #13, which emits into the same table.
 */
export default defineContentScript({
  matches: TOOL_MATCHES,
  main() {
    document.addEventListener(
      'click',
      (event) => {
        if (generateButtonLabel(event.target) === null) return;
        browser.runtime
          .sendMessage({
            source: GENERATE_CLICK_SOURCE,
            payload: { host: window.location.host, clickedAt: Date.now() },
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
 * If the click landed on (or inside) a Generate control, return its accessible
 * label; otherwise null. Walks up at most a few ancestors from the event target
 * to the nearest button-like element and reads its aria-label/text — the minimal
 * DOM read needed to recognise the click, nothing more (AGENTS.md §5).
 */
function generateButtonLabel(target: EventTarget | null): string | null {
  let el = target instanceof Element ? target : null;
  for (let depth = 0; el !== null && depth < 5; depth++, el = el.parentElement) {
    if (!isButtonLike(el)) continue;
    // Stop at the nearest button-like ancestor: if it isn't Generate, don't keep
    // climbing (a Generate button nested in a larger clickable region is rare and
    // out of scope for this minimal tripwire).
    return matchesGenerateLabel(accessibleLabel(el)) ? accessibleLabel(el) : null;
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
