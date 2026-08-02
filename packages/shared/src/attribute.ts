import type { GenerationEvent, RefundState, Tool } from './index';

/**
 * The tool-extracted fields available *before* attribution — everything an
 * adapter can read from the tool's own traffic, with no knowledge of who the
 * editor is or which Asset they're working on. The extension's `ExtractedUsage`
 * (plus the tool, capture time, and rule version known at the capture site) is
 * adapted into this shape and handed to {@link attribute}.
 */
export type ExtractedGeneration = {
  tool: Tool;
  /** Credits charged; 0 when the tool charged nothing (a free generation). */
  cost: number;
  prompt?: string;
  /** One child job id per requested output (event = one Job set). */
  jobIds: string[];
  /** Tool-side job-set id, used to reconcile refunds. */
  toolRef?: string;
  /**
   * The shared tool seat observed in the tool's own traffic (e.g. Higgsfield's
   * `job_sets[].jobs[].user_id`), captured as metadata only — never our editor
   * identity (ADR-0004). Undefined when the tool did not expose one.
   */
  toolAccount?: string;
  refund?: RefundState;
  capturedAt: number;
  ruleVersion: number;
};

/**
 * The attribution context an editor establishes in the popup: their identity
 * from our own login (never the tool seat — ADR-0004) and the Org / Brand /
 * Active Asset they're currently working under. `assetId` is `null` when no
 * Active Asset is selected. The tool seat is not here — it is captured from tool
 * traffic (see {@link ExtractedGeneration.toolAccount}), not chosen in the popup.
 */
export type ActiveContext = {
  organizationId: string;
  userId: string;
  brandId: string;
  /** The Active Asset, or `null` when the editor has none selected. */
  assetId: string | null;
};

/**
 * A generation the deterministic runtime could not fully classify, recorded
 * with its evidence rather than guessed (ADR-0002, CONTEXT.md "Flagged
 * anomaly"): a Generate click with no matching request, a cancelled request, an
 * unknown Job status, or a Cost that disagrees with the button — inputs to the
 * Discovery agent (ADR-0003), *not* the same thing as an unattributed
 * generation, which is a real {@link GenerationEvent} resolved by Assignment.
 *
 * This is the declared second arm of the ticket-05 signature and the seam those
 * classifiers will plug into; #5 itself wires no anomaly trigger, so `attribute`
 * does not yet construct one.
 */
export type FlaggedAnomaly = {
  /** Why the runtime could not classify this generation. */
  reason: string;
  /** The raw extracted signal, retained as evidence rather than guessed (ADR-0002). */
  evidence: ExtractedGeneration;
};

/**
 * Attribute a tool-extracted generation to the editor's Active context.
 *
 * With an Active Asset selected, the event carries it. With none, the event's
 * `assetId` is the `'unattributed'` sentinel: the charge still rolls up to its
 * Brand and Organization but to no Asset, and the sentinel is itself the
 * needs-assignment flag an editor later resolves via Assignment (CONTEXT.md).
 * Either way the result is a real {@link GenerationEvent} — an unattributed
 * generation is not a {@link FlaggedAnomaly}. Pure: no I/O, no clock.
 */
export function attribute(
  extracted: ExtractedGeneration,
  ctx: ActiveContext,
): GenerationEvent | FlaggedAnomaly {
  return {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    brandId: ctx.brandId,
    // `null` Active Asset ⇒ the `'unattributed'` sentinel, flagged for assignment.
    assetId: ctx.assetId ?? 'unattributed',
    assignment: ctx.assetId === null ? { status: 'needs-assignment' } : { status: 'assigned' },
    tool: extracted.tool,
    cost: extracted.cost,
    prompt: extracted.prompt,
    jobs: extracted.jobIds.map((jobId) => ({ jobId, status: 'queued' })),
    refund: extracted.refund ?? { kind: 'none' },
    capturedAt: extracted.capturedAt,
    toolRef: extracted.toolRef,
    // The tool seat comes from observed traffic, not the popup (ADR-0004).
    toolAccount: extracted.toolAccount,
    ruleVersion: extracted.ruleVersion,
  };
}

/**
 * Narrow an {@link attribute} result to the flagged-anomaly arm — evidence for
 * the Discovery agent, never recorded as a billable event.
 */
export function isFlaggedAnomaly(
  result: GenerationEvent | FlaggedAnomaly,
): result is FlaggedAnomaly {
  return 'evidence' in result;
}
