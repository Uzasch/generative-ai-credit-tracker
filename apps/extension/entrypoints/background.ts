import { appendRawCapture } from '@/lib/convex';
import { isCaptureHostUrl, isCaptureMessage } from '@/lib/messaging';
import { type CapturedResponse, extractUsage } from '@/lib/tools';

/**
 * Background: receives raw captures from the bridge and retains them in the
 * append-only `raw_captures` Convex table (Phase-1 discovery, ADR-0001). It also
 * runs the tool adapters to surface a usage signal, but that path is not yet
 * wired to the structured `events` pipeline (attribution — open Qs).
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isCaptureMessage(message)) return;
    const capture = message.payload;

    // Re-enforce host scope at the trust boundary: the MAIN world is shared with
    // the page, so a page script could post a well-formed message for any URL.
    // Only fnf-api-gw traffic is ever retained (ADR-0001, criterion 1).
    if (!isCaptureHostUrl(capture.url)) return;

    // Retain raw traffic first — this is the deliverable of the capture probe.
    void appendRawCapture(capture);

    // Best-effort structured extraction over the JSON response, if any.
    const parsed = parseJson(capture.responseBody);
    if (parsed === undefined) return;
    const res: CapturedResponse = {
      url: capture.url,
      method: capture.method,
      status: capture.status,
      body: parsed,
    };
    const result = extractUsage(res);
    if (!result) return;

    // TODO: attribution — resolve current userId, brandId, assetId (open Qs),
    // then call the Convex `events.record` mutation. For now, log the signal.
    console.debug('[token-tracker] usage captured', result.tool, result.usage);
  });
});

/** Parse a captured body as JSON; undefined if absent or not JSON. */
function parseJson(body: string | null): unknown {
  if (body == null) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
