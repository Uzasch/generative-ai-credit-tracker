import { CAPTURE_SOURCE, TOOL_MATCHES } from '@/lib/messaging';
import type { RawCapture } from '@/lib/tools';

/**
 * MAIN-world content script: monkey-patches fetch to OBSERVE (never modify,
 * block, or delay) Higgsfield API traffic, and postMessages a raw capture to
 * the ISOLATED bridge. MAIN world has no chrome.* access, so it can only
 * postMessage (AGENTS.md §5).
 *
 * Scope (ADR-0001): capture is restricted to the API gateway host only. Auth
 * (`clerk`), storage (`kopir`), `cms`, and `sentry` traffic is never captured.
 * Request headers are never read, so no auth token can leak into a capture.
 */
const CAPTURE_HOST = 'fnf-api-gw.higgsfield.ai';

export default defineContentScript({
  matches: TOOL_MATCHES,
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const originalFetch = window.fetch;
    window.fetch = (...args) => {
      const [input, init] = args;
      // Fast path: only the API gateway is in scope; everything else (clerk /
      // kopir / cms / sentry) passes straight through, uncaptured.
      const url = requestUrl(input);
      if (!url || hostOf(url) !== CAPTURE_HOST) {
        return originalFetch(...args);
      }

      // Snapshot the request WITHOUT delaying the real fetch: method is read
      // synchronously; a Request body is cloned synchronously (reading text is
      // deferred). Headers are deliberately ignored, so no auth token leaks.
      const method = requestMethod(input, init);
      const requestSource = requestBodySource(input, init);

      // Fire the real request immediately — observe only, never block or modify.
      const responsePromise = originalFetch(...args);
      void responsePromise.then((response) => {
        // Clone so the page still consumes the body untouched.
        inspect(url, method, requestSource, response.clone());
      });
      return responsePromise;
    };

    async function inspect(
      url: string,
      method: string,
      requestSource: RequestBodySource,
      response: Response,
    ): Promise<void> {
      const [requestBody, responseBody] = await Promise.all([
        readRequestBody(requestSource),
        response.text().catch(() => null),
      ]);
      const payload: RawCapture = {
        url,
        method,
        status: response.status,
        requestBody,
        responseBody,
        capturedAt: Date.now(),
      };
      window.postMessage({ source: CAPTURE_SOURCE, payload }, window.location.origin);
    }

    // TODO: also patch XMLHttpRequest for calls that use XHR instead of fetch.
  },
});

/** Resolve the request URL from a fetch input, or null if it can't be read. */
function requestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url, window.location.origin).host;
  } catch {
    return null;
  }
}

/** Effective HTTP method: init wins, then a Request's method, else GET. */
function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  return method.toUpperCase();
}

/**
 * A synchronous snapshot of where the request body lives, captured before the
 * real fetch runs: either an `init.body` value, or a Request cloned up front so
 * the page's own request stream stays intact. Reading the text is deferred.
 */
type RequestBodySource =
  | { kind: 'init'; body: BodyInit | null }
  | { kind: 'request'; clone: Request }
  | { kind: 'none' };

/** Snapshot the body source synchronously — no awaits, so the fetch isn't delayed. */
function requestBodySource(input: RequestInfo | URL, init?: RequestInit): RequestBodySource {
  // init.body takes precedence over a Request body when both are present.
  if (init && 'body' in init) {
    return { kind: 'init', body: init.body ?? null };
  }
  if (input instanceof Request) {
    // Clone synchronously so the page's request stream stays intact.
    return { kind: 'request', clone: input.clone() };
  }
  return { kind: 'none' };
}

/**
 * Best-effort serialization of the snapshotted request body. Returns null when
 * there is no body or it isn't a text-like payload (e.g. a stream or binary
 * blob we won't retain). Never reads headers.
 */
async function readRequestBody(source: RequestBodySource): Promise<string | null> {
  if (source.kind === 'init') return serializeBody(source.body);
  if (source.kind === 'request') {
    try {
      const text = await source.clone.text();
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }
  return null;
}

function serializeBody(body: BodyInit | null): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  // FormData / Blob / ArrayBuffer / streams: not retained as text for now.
  return null;
}
