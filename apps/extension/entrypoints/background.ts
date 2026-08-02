import { loadActiveContext } from '@/lib/activeContext';
import { badgeText, nextBadgeExpiry, pruneCaptures } from '@/lib/badge';
import {
  appendRawCapture,
  recordAnomaly,
  recordGenerationEvent,
  recordJobStatus,
} from '@/lib/convex';
import { DisplayedCostCorrelator } from '@/lib/displayedCost';
import {
  type GenerateClickPayload,
  type RequestStartedPayload,
  isCaptureHostUrl,
  isCaptureMessage,
  isGenerateClickMessage,
  isRequestStartedMessage,
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
  type Tool,
  attribute,
  isFlaggedAnomaly,
  isJobStatus,
  reconcileDisplayedCost,
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
 * How long after a Generate click the runtime will still pair the button's
 * displayed cost (#13) with a generate response captured in the same tab. The
 * generate POST returns its job set promptly (it only enqueues), so the response
 * lands within a couple of seconds; the same window as the click↔request check
 * (plus its edge buffer) covers that with margin without buffering stale figures.
 */
const DISPLAYED_COST_WINDOW_MS = CLICK_WINDOW_MS + CLICK_SWEEP_BUFFER_MS;

/**
 * Pairs a Generate button's displayed cost (observed at click, from the tripwire)
 * with the authoritative cost on its generate response (from the capture path),
 * per tab. A matched pair is cross-checked against ADR-0005's ÷100 rule; a
 * divergence becomes a `cost-mismatch` anomaly (#13). Module-level so it spans
 * messages within one service-worker lifetime; pure logic lives in
 * `@/lib/displayedCost`.
 */
const costCorrelator = new DisplayedCostCorrelator(DISPLAYED_COST_WINDOW_MS);

/**
 * How long a recorded generation keeps the toolbar badge lit (issue #18). The
 * badge reflects *recent* activity, not a stale lifetime count, so captures decay
 * out of this rolling window and the badge clears once activity stops. Two minutes
 * is long enough to still be lit when the editor glances up after a generate, short
 * enough that a number left on the toolbar always means "just now".
 */
const BADGE_WINDOW_MS = 120_000;

/**
 * Session-storage key holding the capture times inside the current badge window,
 * and the alarm that decays them. Both are *durable* across service-worker
 * restarts, unlike an in-memory count or a `setTimeout`: MV3 can terminate an idle
 * worker between captures, and the toolbar badge text persists on its own — so the
 * decay must be driven from persisted state + a browser alarm, or a badge could
 * stay lit indefinitely after the worker that would have cleared it was killed.
 * Session storage is used (not local) so the count is naturally ephemeral —
 * "recent activity" resets when the browser session ends.
 */
const BADGE_CAPTURES_KEY = 'badgeCaptures';
const BADGE_DECAY_ALARM = 'badge-decay';

/** Read the persisted badge capture times; tolerant of the first-ever (unset) read. */
async function loadBadgeCaptures(): Promise<number[]> {
  const stored = await browser.storage.session.get(BADGE_CAPTURES_KEY);
  const value = stored[BADGE_CAPTURES_KEY];
  // Trust nothing off storage: keep only finite numbers (§4 — narrow at boundaries).
  return Array.isArray(value) ? value.filter((t): t is number => Number.isFinite(t)) : [];
}

/**
 * Render `times` onto the toolbar badge and (re)arm the decay alarm for when the
 * oldest capture ages out. `browser.action` is the MV3 toolbar button; the alarm
 * recomputes durably even if the worker is torn down before it fires.
 */
async function paintBadge(times: readonly number[]): Promise<void> {
  await browser.action.setBadgeText({ text: badgeText(times.length) });
  // A subtle attention colour; the count is the signal, not the colour alone.
  await browser.action.setBadgeBackgroundColor({ color: '#2563eb' });
  const expiry = nextBadgeExpiry(times, BADGE_WINDOW_MS);
  if (expiry === null) {
    await browser.alarms.clear(BADGE_DECAY_ALARM);
  } else {
    // `when` is absolute ms; a passed/near time fires promptly, then reschedules
    // for the next oldest capture until the window is empty.
    browser.alarms.create(BADGE_DECAY_ALARM, { when: expiry });
  }
}

/**
 * Serializes the badge's read-modify-write of persisted state. Each capture and
 * each decay reads the stored window, changes it, and writes it back; without
 * serialization two overlapping runs could both read the same value and clobber
 * each other's write (e.g. two captures each reading `[]` → a count of 1, not 2).
 * Chaining every mutation onto one tail promise makes them apply in order within a
 * worker lifetime. `catch` keeps a failed step from wedging the queue.
 */
let badgeQueue: Promise<void> = Promise.resolve();
function enqueueBadge(step: () => Promise<void>): void {
  badgeQueue = badgeQueue.then(step, step).catch(() => {
    // A badge update is best-effort; swallow so the next step still runs.
  });
}

/**
 * Flip the toolbar badge to reflect a just-recorded generation (issue #18): prune
 * the persisted window, count this capture into it, persist, and repaint. Durable
 * so a burst spanning a worker restart still decays correctly; serialized so
 * concurrent captures never lose a count.
 */
function flipBadge(now: number): void {
  enqueueBadge(async () => {
    const times = pruneCaptures(await loadBadgeCaptures(), now, BADGE_WINDOW_MS);
    times.push(now);
    await browser.storage.session.set({ [BADGE_CAPTURES_KEY]: times });
    await paintBadge(times);
  });
}

/**
 * Decay the badge when a capture ages out (fired by the durable alarm, or replayed
 * on worker startup): prune the persisted window, persist, and repaint — clearing
 * the badge once nothing recent remains. Serialized alongside `flipBadge` so a
 * decay never races a concurrent capture's write.
 */
function decayBadge(now: number): void {
  enqueueBadge(async () => {
    const times = pruneCaptures(await loadBadgeCaptures(), now, BADGE_WINDOW_MS);
    await browser.storage.session.set({ [BADGE_CAPTURES_KEY]: times });
    await paintBadge(times);
  });
}

/**
 * Background: receives raw captures from the bridge and retains them in the
 * append-only `raw_captures` Convex table (Phase-1 discovery, ADR-0001). It then
 * runs the tool adapters over each capture and either records a structured
 * `GenerationEvent` (a new generation, attributed via the editor's Active
 * context) or patches an existing event's job outcome (a passive status poll).
 *
 * It also receives Generate-click reports from the tripwire and correlates them
 * against captured generate requests, raising a `click-no-request` Flagged
 * anomaly for a click with no request in the window (#8, ADR-0002). Each click
 * also carries the button's displayed credits (#13), reconciled against the
 * response cost to raise a `cost-mismatch` anomaly when ADR-0005's ÷100 rule broke.
 */
export default defineBackground(() => {
  // Recompute the badge from durable state whenever the worker (re)starts: an MV3
  // worker can be killed with the badge still lit, so replay the decay to clear a
  // count that has since aged out (issue #18 — recent activity, never stale).
  decayBadge(Date.now());

  // The durable decay alarm: prune the persisted badge window and repaint, so the
  // badge clears even if the worker that recorded the capture was long gone.
  browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === BADGE_DECAY_ALARM) decayBadge(Date.now());
  });

  // Only the sender's tab id is needed — to scope click↔request correlation per
  // tab. Typed structurally to that so no browser-types import is required.
  browser.runtime.onMessage.addListener((message: unknown, sender: { tab?: { id?: number } }) => {
    if (isCaptureMessage(message)) {
      // The sender's tab scopes the displayed-cost cross-check (#13) to the same
      // tab the Generate click came from, mirroring the click↔request correlation.
      void handleCapture(message.payload, sender.tab?.id);
      return;
    }
    // Both the request-start signal and the Generate click are correlated per
    // browser tab (the sender's tab id), so a request in one tab can't consume a
    // click in another and suppress its anomaly.
    if (isRequestStartedMessage(message)) {
      handleRequestStarted(message.payload, sender.tab?.id);
      return;
    }
    if (isGenerateClickMessage(message)) {
      void handleGenerateClick(message.payload, sender.tab?.id);
      return;
    }
  });
});

/**
 * A request fired in tab `tabId`. If it's a generate request (recognised by shape
 * — method + URL — alone), it explains a pending Generate click in the same tab,
 * so that click is not a `click-no-request` anomaly (#8, ADR-0002). Correlating on
 * the request *start* (this signal) rather than response completion means a slow
 * generate POST still matches its click within the window.
 */
function handleRequestStarted(payload: RequestStartedPayload, tabId?: number): void {
  // status/body are irrelevant to the generate-request shape check (documented on
  // `isGenerateRequest`), so a minimal synthetic response carries the URL+method.
  const res: CapturedResponse = {
    url: payload.url,
    method: payload.method,
    status: 0,
    body: undefined,
  };
  if (isGenerateRequest(res)) clickCorrelator.onGenerateRequest(payload.startedAt, tabId);
}

/**
 * Register an observed Generate click from tab `tabId`, then schedule a sweep once
 * its window has elapsed. A generate request observed in the same tab meanwhile
 * removes the click from the sweep (`clickCorrelator.onGenerateRequest`); anything
 * still unmatched is recorded as a `click-no-request` anomaly (ADR-0002).
 *
 * The editor's Active Organization is resolved and bound to the click NOW, not at
 * sweep time: an Org switch during the correlation window must not misattribute
 * the anomaly to a different tenant (ADR-0004).
 */
async function handleGenerateClick(payload: GenerateClickPayload, tabId?: number): Promise<void> {
  // Buffer the button's displayed cost (#13) SYNCHRONOUSLY, before the await below:
  // a fast generate response's `handleCapture` could otherwise run its ÷100
  // cross-check (ADR-0005) while this handler is still suspended in
  // `loadActiveContext`, and miss the cost entirely. It needs no Active context —
  // the Org for any resulting anomaly comes from the capture side. Absent when the
  // button exposed no readable figure — then there is simply nothing to pair.
  if (payload.displayedCost !== undefined) {
    costCorrelator.onClick(payload.displayedCost.value, payload.clickedAt, tabId);
  }
  const ctx = await loadActiveContext();
  clickCorrelator.onClick({
    host: payload.host,
    clickedAt: payload.clickedAt,
    tabId,
    organizationId: ctx?.organizationId,
  });
  setTimeout(() => {
    flushExpiredClicks();
  }, CLICK_WINDOW_MS + CLICK_SWEEP_BUFFER_MS);
}

/**
 * Record a `click-no-request` anomaly for every click whose window has elapsed
 * with no matching generate request, attributing each to the Organization that
 * was Active when the click was observed (bound in `handleGenerateClick`). A click
 * observed with no Active context carries no Org and is dropped — we never invent
 * one (ADR-0004), consistent with the capture path.
 */
function flushExpiredClicks(): void {
  for (const click of clickCorrelator.sweepExpired(Date.now())) {
    if (click.organizationId === undefined) {
      console.warn('[token-tracker] click had no Active Org — click-no-request anomaly dropped');
      continue;
    }
    // The tripwire only runs on the tracked tool hosts, so this is defensive.
    const tool = toolFromHost(click.host);
    if (tool === null) continue;
    void recordAnomaly({
      organizationId: click.organizationId,
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

/**
 * Reconcile the credits the Generate button displayed at click time (buffered per
 * tab in `costCorrelator`) with this generate response's authoritative cost, and
 * record a `cost-mismatch` anomaly when ADR-0005's ÷100 rule broke (#13). The
 * response cost is never changed — the button figure is a cross-check only. When
 * no displayed cost was paired (the button showed no readable figure, or its click
 * was in another tab), there is nothing to check and nothing is flagged.
 */
function crossCheckDisplayedCost(args: {
  tool: Tool;
  responseCost: number;
  toolRef?: string;
  observedAt: number;
  tabId?: number;
  organizationId: string;
}): void {
  const displayedCredits = costCorrelator.matchResponse(args.observedAt, args.tabId);
  if (displayedCredits === null) return;
  const reconciliation = reconcileDisplayedCost(displayedCredits, args.responseCost);
  if (reconciliation.kind !== 'mismatch') return;
  void recordAnomaly({
    organizationId: args.organizationId,
    tool: args.tool,
    toolRef: args.toolRef,
    observedAt: args.observedAt,
    evidence: {
      kind: 'cost-mismatch',
      displayedCost: reconciliation.displayedCost,
      responseCost: reconciliation.responseCost,
      expectedCost: reconciliation.expectedCost,
    },
  });
}

async function handleCapture(capture: RawCapture, tabId?: number): Promise<void> {
  // Re-enforce host scope at the trust boundary: the MAIN world is shared with
  // the page, so a page script could post a well-formed message for any URL.
  // Only fnf-api-gw traffic is ever retained (ADR-0001, criterion 1).
  if (!isCaptureHostUrl(capture.url)) return;

  // Retain raw traffic first — this is the deliverable of the capture probe.
  void appendRawCapture(capture);

  // Best-effort structured extraction needs a JSON response body. (The click
  // tripwire correlates against the request-*start* signal, not this completed
  // capture — see `handleRequestStarted` — so a slow response can't outrun the
  // click's window.)
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

  // Displayed-cost cross-check (#13, ADR-0005 guardrail): pair this response's
  // authoritative cost with the credits the Generate button showed at click time
  // (buffered per tab in `handleGenerateClick`) and flag a `cost-mismatch` if the
  // ÷100 rule broke for this model. The response cost stays the billed Cost — the
  // button figure is metadata only and never overwrites `result.usage.cost`.
  crossCheckDisplayedCost({
    tool: result.tool,
    responseCost: result.usage.cost,
    toolRef: result.usage.toolRef,
    observedAt: capture.capturedAt,
    tabId,
    organizationId: ctx.organizationId,
  });

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
  // Flip the toolbar badge only after the event actually lands in the source of
  // truth (issue #18): a badge that lit on a dropped write would tell the editor
  // "we got it" for a generation the popup list will never show.
  const recorded = await recordGenerationEvent(outcome);
  if (recorded) flipBadge(capture.capturedAt);
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
