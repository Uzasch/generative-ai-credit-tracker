import { TOOL_MATCHES, isCaptureMessage } from '@/lib/messaging';

/**
 * ISOLATED-world bridge: receives window messages from the MAIN-world patch and
 * forwards raw captures to the background, which does extraction + attribution.
 */
export default defineContentScript({
  matches: TOOL_MATCHES,
  main() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (!isCaptureMessage(event.data)) return;
      browser.runtime.sendMessage(event.data).catch(() => {
        // background may be asleep; capture is best-effort.
      });
    });
  },
});
