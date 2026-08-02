import { appendRawCapture, recordGenerationEvent } from '@/lib/convex';
import { isCaptureHostUrl, isCaptureMessage } from '@/lib/messaging';
import { type CapturedResponse, extractUsage } from '@/lib/tools';

/**
 * Stubbed attribution context. Real attribution — the Active Asset chosen in the
 * popup and `userId` from our own login (ADR-0004) — arrives in a later ticket.
 * Until then every event is recorded against a fixed context with an
 * `unattributed` asset so a real charge is never lost.
 */
const STUB_ORGANIZATION_ID = 'org_stub';
const STUB_USER_ID = 'user_stub';
const STUB_BRAND_ID = 'brand_stub';
const UNATTRIBUTED_ASSET_ID = 'unattributed';

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

    // Record one structured GenerationEvent per recognised generation. Cost and
    // toolRef come from the tool; org/user/brand are stubbed and the asset is
    // `unattributed` until real attribution lands (ADR-0004). Child jobs are
    // recorded as `queued` — their freshly-created state on the generate
    // response; observed status transitions arrive via status polls later.
    void recordGenerationEvent({
      organizationId: STUB_ORGANIZATION_ID,
      userId: STUB_USER_ID,
      tool: result.tool,
      brandId: STUB_BRAND_ID,
      assetId: UNATTRIBUTED_ASSET_ID,
      prompt: result.usage.prompt,
      cost: result.usage.cost,
      jobs: result.usage.jobIds.map((jobId) => ({ jobId, status: 'queued' as const })),
      capturedAt: capture.capturedAt,
      toolRef: result.usage.toolRef,
      ruleVersion: RULE_VERSION,
    });
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
