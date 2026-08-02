import { loadActiveContext } from '@/lib/activeContext';
import { appendRawCapture, recordGenerationEvent, recordJobStatus } from '@/lib/convex';
import { isCaptureHostUrl, isCaptureMessage } from '@/lib/messaging';
import { type CapturedResponse, type RawCapture, extractUsage } from '@/lib/tools';
import {
  type ExtractedGeneration,
  attribute,
  isFlaggedAnomaly,
  isJobStatus,
} from '@token-tracker/shared';

/**
 * Version of the detection rule that produced these events (ADR-0003). Bump when
 * the extraction logic changes so a rule's blast radius stays queryable.
 */
const RULE_VERSION = 1;

/**
 * Background: receives raw captures from the bridge and retains them in the
 * append-only `raw_captures` Convex table (Phase-1 discovery, ADR-0001). It then
 * runs the tool adapters over each capture and either records a structured
 * `GenerationEvent` (a new generation, attributed via the editor's Active
 * context) or patches an existing event's job outcome (a passive status poll).
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isCaptureMessage(message)) return;
    void handleCapture(message.payload);
  });
});

async function handleCapture(capture: RawCapture): Promise<void> {
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

  // Both branches attribute to the editor's Active context (ADR-0004). Without
  // one, the raw capture retained above is the durable record (ADR-0001) — we
  // never invent an Organization, so we skip structured recording here. The
  // popup persists a default context on first open.
  const ctx = await loadActiveContext();
  if (!ctx) {
    console.warn(
      '[token-tracker] no Active context yet — retained raw capture only, skipped structured event',
    );
    return;
  }

  if (result.usage.kind === 'status') {
    // Passive outcome update from the tool's own status polls. Correlate each job
    // back to its event and patch the matching outcome (Convex matches by job id),
    // scoped to the same tenant the event was recorded under (ADR-0004). A status
    // we don't recognise is ignored — never coerced into a JobStatus (ADR-0002);
    // the unknown-status Flagged anomaly is issue #8.
    for (const update of result.usage.updates) {
      if (!isJobStatus(update.status)) continue;
      void recordJobStatus({
        organizationId: ctx.organizationId,
        jobId: update.jobId,
        status: update.status,
        mediaUrl: update.mediaUrl,
      });
    }
    return;
  }

  // A new generation: attribute it to the Active context and record it. Child
  // jobs start `queued` — their freshly-created state on the generate response;
  // observed status transitions arrive via the status polls above (ADR-0002).
  const extracted: ExtractedGeneration = {
    tool: result.tool,
    cost: result.usage.cost,
    prompt: result.usage.prompt,
    jobIds: result.usage.jobIds,
    toolRef: result.usage.toolRef,
    toolAccount: result.usage.toolAccount,
    refund: result.usage.refund,
    capturedAt: capture.capturedAt,
    ruleVersion: RULE_VERSION,
  };

  const outcome = attribute(extracted, ctx);
  if (isFlaggedAnomaly(outcome)) {
    // A genuine Flagged anomaly is evidence for the Discovery agent, not a
    // billable event; the raw capture retained above is its record (ADR-0001).
    console.warn(`[token-tracker] flagged anomaly (not recorded): ${outcome.reason}`);
    return;
  }
  // Attributed or `unattributed` — either way a real event to record; the
  // `'unattributed'` sentinel is the needs-assignment flag (CONTEXT.md).
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
