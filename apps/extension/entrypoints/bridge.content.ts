import { TOOL_MATCHES, isCaptureMessage, isRequestStartedMessage } from '@/lib/messaging';

/**
 * ISOLATED-world bridge: receives window messages from the MAIN-world patch and
 * forwards them to the background. Two kinds: raw captures (extraction +
 * attribution) and request-start signals (click-tripwire correlation, #8).
 * Forwarding via `runtime.sendMessage` stamps the sender's tab, which the
 * background uses to scope click↔request correlation per tab.
 */
export default defineContentScript({
  matches: TOOL_MATCHES,
  main() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (!isCaptureMessage(event.data) && !isRequestStartedMessage(event.data)) return;
      browser.runtime.sendMessage(event.data).catch(() => {
        // background may be asleep; observation is best-effort.
      });
    });
  },
});
