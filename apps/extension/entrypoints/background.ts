import { loadActiveContext } from '@/lib/activeContext';
import {
  appendRawCapture,
  recordAnomaly,
  recordGenerationEvent,
  recordJobStatus,
} from '@/lib/convex';
import {
  type GenerateClickPayload,
  isCaptureHostUrl,
  isCaptureMessage,
  isGenerateClickMessage,
} from '@/lib/messaging';
import {
  type CapturedResponse,
  type RawCapture,
  extractUsage,
  isGenerateRequest,
} from '@/lib/tools';
import { ClickRequestCorrelator, toolFromHost } from '@/lib/tripwire';
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
 * How long after a Generate click the runtime waits for its generate request
 * before flagging a `click-no-request` anomaly (ADR-0002). The generate POST
 * follows a click within a couple of seconds; 4s covers that with margin.
 */
const CLICK_WINDOW_MS = 4000;

/**
 * Extra delay on the per-click sweep timer, so a request landing right at the
 * window edge is counted (via `onGenerateRequest`) before the click is swept.
 */
const CLICK_SWEEP_BUFFER_MS = 500;

/**
 * Pairs observed Generate clicks (from the ISOLATED-world tripwire) with observed
 * generate requests (#8). Module-level so it spans messages within one service
 * worker lifetime; pure correlation logic lives in `@/lib/tripwire`.
 */
const clickCorrelator = new ClickRequestCorrelator(CLICK_WINDOW_MS);

/**
 * Background: receives raw captures from the bridge and retains them in the
 * append-only `raw_captures` Convex table (Phase-1 discovery, ADR-0001). It then
 * runs the tool adapters over each capture and either records a structured
 * `GenerationEvent` (a new generation, attributed via the editor's Active
 * context) or patches an existing event's job outcome (a passive status poll).
 *
 * It also receives Generate-click reports from the tripwire and correlates them
 * against captured generate requests, raising a `click-no-request` Flagged
 * anomaly for a click with no request in the window (#8, ADR-0002).
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (isCaptureMessage(message)) {
      void handleCapture(message.payload);
      return;
    }
    if (isGenerateClickMessage(message)) {
      handleGenerateClick(message.payload);
      return;
    }
  });
});

/**
 * Register an observed Generate click, then schedule a sweep once its window has
 * elapsed. A generate request captured in the meantime removes the click from the
 * sweep (`clickCorrelator.onGenerateRequest`); anything still unmatched is
 * recorded as a `click-no-request` anomaly (ADR-0002).
 */
function handleGenerateClick(payload: GenerateClickPayload): void {
  clickCorrelator.onClick({ host: payload.host, clickedAt: payload.clickedAt });
  setTimeout(() => {
    void flushExpiredClicks();
  }, CLICK_WINDOW_MS + CLICK_SWEEP_BUFFER_MS);
}

/**
 * Record a `click-no-request` anomaly for every click whose window has elapsed
 * with no matching generate request. Scoped to the editor's Active Organization
 * (ADR-0004): with no Active context we don't invent one — the clicks are dropped,
 * consistent with the capture path.
 */
async function flushExpiredClicks(): Promise<void> {
  const expired = clickCorrelator.sweepExpired(Date.now());
  if (expired.length === 0) return;

  const ctx = await loadActiveContext();
  if (!ctx) {
    console.warn('[token-tracker] no Active context — click-no-request anomalies dropped');
    return;
  }

  for (const click of expired) {
    // The tripwire only runs on the tracked tool hosts, so this is defensive.
    const tool = toolFromHost(click.host);
    if (tool === null) continue;
    void recordAnomaly({
      organizationId: ctx.organizationId,
      tool,
      observedAt: click.clickedAt,
      evidence: {
        kind: 'click-no-request',
        host: click.host,
        clickedAt: click.clickedAt,
        windowMs: CLICK_WINDOW_MS,
      },
    });
  }
}

async function handleCapture(capture: RawCapture): Promise<void> {
  // Re-enforce host scope at the trust boundary: the MAIN world is shared with
  // the page, so a page script could post a well-formed message for any URL.
  // Only fnf-api-gw traffic is ever retained (ADR-0001, criterion 1).
  if (!isCaptureHostUrl(capture.url)) return;

  // Retain raw traffic first — this is the deliverable of the capture probe.
  void appendRawCapture(capture);

  const parsed = parseJson(capture.responseBody);
  const res: CapturedResponse = {
    url: capture.url,
    method: capture.method,
    status: capture.status,
    body: parsed,
  };

  // Click tripwire (#8): a captured generate request explains a pending Generate
  // click, so that click is not a `click-no-request` anomaly. Decided on request
  // shape (method + URL), independent of the body — a generate call that errored
  // still counts as "a request happened" (ADR-0002). Done before the body check
  // below so a bodyless/errored generate POST still cancels the click.
  if (isGenerateRequest(res)) clickCorrelator.onGenerateRequest(capture.capturedAt);

  // Best-effort structured extraction needs a JSON response body.
  if (parsed === undefined) return;
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
    // scoped to the same tenant the event was recorded under (ADR-0004).
    for (const update of result.usage.updates) {
      if (!isJobStatus(update.status)) {
        // A status we don't recognise is never coerced into a JobStatus (ADR-0002).
        // Record it as a Flagged anomaly with the raw string as evidence so the
        // offline Discovery agent can classify it (#8), scoped to the same tenant.
        void recordAnomaly({
          organizationId: ctx.organizationId,
          tool: result.tool,
          observedAt: capture.capturedAt,
          evidence: {
            kind: 'unknown-status',
            jobId: update.jobId,
            rawStatus: update.status,
            sourceUrl: capture.url,
          },
        });
        continue;
      }
      void recordJobStatus({
        organizationId: ctx.organizationId,
        jobId: update.jobId,
        status: update.status,
        mediaUrl: update.mediaUrl,
        // Attribute any refund this poll triggers to when the status was
        // observed (the capture time), not to mutation-delivery time. The
        // terminal-status poll is the earliest, most accurate refund timestamp
        // the runtime has (the wallet delta lands seconds later, finding rule 4).
        at: capture.capturedAt,
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
