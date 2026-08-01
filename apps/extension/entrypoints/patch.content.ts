import { CAPTURE_SOURCE, TOOL_MATCHES } from '@/lib/messaging';
import type { CapturedResponse } from '@/lib/tools';

/**
 * MAIN-world content script: monkey-patches fetch to observe (never modify)
 * the tool's responses, and postMessages a raw capture to the ISOLATED bridge.
 * MAIN world has no chrome.* access, so it can only postMessage (AGENTS.md §5).
 */
export default defineContentScript({
  matches: TOOL_MATCHES,
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      // Observe only — clone so the page still consumes the body untouched.
      void inspect(response.clone());
      return response;
    };

    async function inspect(response: Response): Promise<void> {
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) return;
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return;
      }
      const payload: CapturedResponse = {
        url: response.url,
        method: 'GET', // fetch() init method isn't reliably on the Response; refine later.
        status: response.status,
        body,
      };
      window.postMessage({ source: CAPTURE_SOURCE, payload }, window.location.origin);
    }

    // TODO: also patch XMLHttpRequest for tools that use XHR instead of fetch.
  },
});
