import type { Tool } from './index';

/**
 * Flagged anomalies (ADR-0002, CONTEXT.md "Flagged anomaly"): observations the
 * deterministic runtime could not confidently classify, recorded with their raw
 * evidence instead of guessed. They are the input to the offline Discovery agent
 * (ADR-0003) — never a billable {@link GenerationEvent}, never netted into usage.
 *
 * `AnomalyEvidence` is a discriminated union on `kind`; each arm carries the raw
 * signal for one trigger. This ticket (#8) ships two arms:
 *
 *  - `click-no-request` — a Generate click with no matching generate request
 *    within the correlation window. Raised by the ISOLATED-world click tripwire
 *    via background correlation against captured generate requests. The canonical
 *    "cancel a generation after clicking Generate" case (CONTEXT.md).
 *  - `unknown-status` — a Job status string that is not in the shared
 *    {@link JobStatus} union, observed in a status poll. The runtime records the
 *    raw string instead of coercing it into a known status (ADR-0002).
 *
 * EXTENSION POINT (#13): the button displayed-cost capture adds a `cost-mismatch`
 * arm here (button cost ≠ response cost) plus a matching validator arm in
 * `packages/convex/convex/schema.ts`. Nothing else changes — the table, the
 * `record` mutation, and the org-scoped query are all kind-agnostic and already
 * emit into this same table.
 */
export type AnomalyEvidence =
  | {
      kind: 'click-no-request';
      /** Page origin/host where the unmatched Generate click was observed. */
      host: string;
      /** When the click fired, client ms epoch. */
      clickedAt: number;
      /** How long the runtime waited for a matching request before flagging (ms). */
      windowMs: number;
    }
  | {
      kind: 'unknown-status';
      /** The job whose status could not be classified. */
      jobId: string;
      /** Raw status string exactly as observed — never coerced into a JobStatus. */
      rawStatus: string;
      /** Status-poll URL the unknown status came from, retained as evidence. */
      sourceUrl: string;
    };

/** The discriminants of {@link AnomalyEvidence} — the kinds of flagged anomaly. */
export type AnomalyKind = AnomalyEvidence['kind'];

/**
 * The full record the extension hands to the `flaggedAnomalies.record` mutation.
 * `organizationId` scopes it to one tenant (AGENTS.md §6, ADR-0004); `tool` and
 * `toolRef` locate the offending traffic; `observedAt` is the client capture time.
 */
export type FlaggedAnomalyInput = {
  organizationId: string;
  tool: Tool;
  /** Tool-side job/job-set id when the trigger has one; absent for a raw click. */
  toolRef?: string;
  /** Client observation time, ms since epoch. */
  observedAt: number;
  evidence: AnomalyEvidence;
};

/** Type guard for an {@link AnomalyKind} coming off untrusted input. */
export function isAnomalyKind(value: unknown): value is AnomalyKind {
  return value === 'click-no-request' || value === 'unknown-status';
}
