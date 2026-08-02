import { loadActiveContext } from '@/lib/activeContext';
import { appendRawCapture, recordGenerationEvent } from '@/lib/convex';
import { isCaptureHostUrl, isCaptureMessage } from '@/lib/messaging';
import { type CapturedResponse, type ExtractedUsage, extractUsage } from '@/lib/tools';
import {
  type ExtractedGeneration,
  type Tool,
  attribute,
  isFlaggedAnomaly,
} from '@token-tracker/shared';

/**
 * Version of the detection rule that produced these events (ADR-0003). Bump when
 * the extraction logic changes so a rule's blast radius stays queryable.
 */
const RULE_VERSION = 1;

/**
 * Background: receives raw captures from the bridge and retains them in the
 * append-only `raw_captures` Convex table (Phase-1 discovery, ADR-0001). It also
 * runs the tool adapters over each capture and records a structured
 * `GenerationEvent` for every recognised generation (attribution stubbed).
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

    void attributeAndRecord(result.tool, result.usage, capture.capturedAt);
  });
});

/**
 * Attribute a recognised generation to the editor's Active context and record it.
 *
 * The context (identity + Active Asset) is established by the editor in the popup
 * (ADR-0004). With an Active Asset the event carries it; with none, `attribute`
 * yields a `needs-assignment` flagged anomaly whose event is `unattributed` — we
 * still record that event so a real charge is never lost (spec story 4), and the
 * `unattributed` asset is itself the signal the editor later resolves via
 * assignment (CONTEXT.md). Before the editor has set up any context at all, the
 * verbatim raw capture already retained above is the safety net (ADR-0001), so we
 * skip structured recording rather than inventing an Organization or User.
 */
async function attributeAndRecord(
  tool: Tool,
  usage: ExtractedUsage,
  capturedAt: number,
): Promise<void> {
  const ctx = await loadActiveContext();
  if (!ctx) {
    console.warn(
      '[token-tracker] no Active context yet — retained raw capture only, skipped structured event',
    );
    return;
  }

  // Child jobs are `queued` — their freshly-created state on the generate
  // response; observed status transitions arrive via status polls later (ADR-0002).
  const extracted: ExtractedGeneration = {
    tool,
    cost: usage.cost,
    prompt: usage.prompt,
    jobIds: usage.jobIds,
    toolRef: usage.toolRef,
    refund: usage.refund,
    capturedAt,
    ruleVersion: RULE_VERSION,
  };

  const outcome = attribute(extracted, ctx);
  if (isFlaggedAnomaly(outcome)) {
    console.warn(`[token-tracker] generation flagged (${outcome.kind}): ${outcome.reason}`);
    void recordGenerationEvent(outcome.event);
    return;
  }
  void recordGenerationEvent(outcome);
}

/** Parse a captured body as JSON; undefined if absent or not JSON. */
function parseJson(body: string | null): unknown {
  if (body == null) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
