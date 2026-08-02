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
  refund?: RefundState;
  capturedAt: number;
  ruleVersion: number;
};

/**
 * The attribution context an editor establishes in the popup: their identity
 * from our own login (never the tool seat — ADR-0004) and the Org / Brand /
 * Active Asset they're currently working under. `assetId` is `null` when no
 * Active Asset is selected.
 */
export type ActiveContext = {
  organizationId: string;
  userId: string;
  brandId: string;
  /** The Active Asset, or `null` when the editor has none selected. */
  assetId: string | null;
  /** Shared tool seat (e.g. `aibusiness@…`), captured as metadata only (ADR-0004). */
  toolAccount?: string;
};

/**
 * A generation the deterministic runtime could not fully classify, recorded
 * with its evidence rather than guessed (ADR-0002, CONTEXT.md "Flagged
 * anomaly"). For issue #5 the only kind is `'needs-assignment'`: a real charge
 * captured with no Active Asset. The charge is never lost — the fully-stamped
 * `event` (with the `'unattributed'` asset sentinel) rides along and is what
 * gets recorded, so an editor can later assign it to an Asset from the gallery.
 */
export type FlaggedAnomaly = {
  kind: 'needs-assignment';
  /** Human-readable explanation of why this generation could not be attributed. */
  reason: string;
  /** The underlying generation event, stamped `unattributed`. Never discarded. */
  event: GenerationEvent;
};

/**
 * Attribute a tool-extracted generation to the editor's Active context.
 *
 * With an Active Asset selected, the result is a fully-stamped
 * {@link GenerationEvent}. With none, the result is a {@link FlaggedAnomaly} of
 * kind `'needs-assignment'` whose `event.assetId` is the `'unattributed'`
 * sentinel — the charge still rolls up to its Brand and Organization but to no
 * Asset until assigned (CONTEXT.md "Assignment"). Pure: no I/O, no clock.
 */
export function attribute(
  extracted: ExtractedGeneration,
  ctx: ActiveContext,
): GenerationEvent | FlaggedAnomaly {
  const event: GenerationEvent = {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    brandId: ctx.brandId,
    assetId: ctx.assetId ?? 'unattributed',
    tool: extracted.tool,
    cost: extracted.cost,
    prompt: extracted.prompt,
    jobs: extracted.jobIds.map((jobId) => ({ jobId, status: 'queued' })),
    refund: extracted.refund ?? { kind: 'none' },
    capturedAt: extracted.capturedAt,
    toolRef: extracted.toolRef,
    toolAccount: ctx.toolAccount,
    ruleVersion: extracted.ruleVersion,
  };

  if (ctx.assetId === null) {
    return {
      kind: 'needs-assignment',
      reason: 'No Active Asset was selected when this generation was captured.',
      event,
    };
  }

  return event;
}

/** Narrow an {@link attribute} result to the flagged-anomaly branch. */
export function isFlaggedAnomaly(
  result: GenerationEvent | FlaggedAnomaly,
): result is FlaggedAnomaly {
  return 'kind' in result;
}
