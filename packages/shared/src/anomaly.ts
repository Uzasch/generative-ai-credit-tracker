import type { Tool } from './index';

/**
 * Flagged anomalies (ADR-0002, CONTEXT.md "Flagged anomaly"): observations the
 * deterministic runtime could not confidently classify, recorded with their raw
 * evidence instead of guessed. They are the input to the offline Discovery agent
 * (ADR-0003) — never a billable {@link GenerationEvent}, never netted into usage.
 *
 * `AnomalyEvidence` is a discriminated union on `kind`; each arm carries the raw
 * signal for one trigger. Three arms ship today:
 *
 *  - `click-no-request` (#8) — a Generate click with no matching generate request
 *    within the correlation window. Raised by the ISOLATED-world click tripwire
 *    via background correlation against captured generate requests. The canonical
 *    "cancel a generation after clicking Generate" case (CONTEXT.md).
 *  - `unknown-status` (#8) — a Job status string that is not in the shared
 *    {@link JobStatus} union, observed in a status poll. The runtime records the
 *    raw string instead of coercing it into a known status (ADR-0002).
 *  - `cost-mismatch` (#13) — the credits rendered on the Generate button at click
 *    time disagree with the authoritative response cost under ADR-0005's ÷100
 *    rule (`displayedCost × 100 ≠ job_sets[].cost`). The response cost stays the
 *    billed Cost; the button figure is a cross-check only, retained as evidence
 *    that a model may have violated the display ratio (see `reconcileDisplayedCost`).
 *
 * Adding an arm means adding it in all three mirrors: here, the Convex validator
 * (`packages/convex/convex/schema.ts` + `flaggedAnomalies.ts`), and `isAnomalyKind`
 * below. The table, `record` mutation, and org-scoped query stay kind-agnostic.
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
    }
  | {
      kind: 'cost-mismatch';
      /** Credits shown on the Generate button at click time (the ÷100 figure). */
      displayedCost: number;
      /** Authoritative internal cost from `job_sets[].cost` — the billed unit. */
      responseCost: number;
      /** What `responseCost` should have been under ADR-0005: `displayedCost × 100`. */
      expectedCost: number;
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
  return value === 'click-no-request' || value === 'unknown-status' || value === 'cost-mismatch';
}
