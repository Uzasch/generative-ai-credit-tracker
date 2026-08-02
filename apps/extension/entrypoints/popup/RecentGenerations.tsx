import { recentGenerationsRef } from '@/lib/recentGenerations';
import {
  INTERNAL_UNITS_PER_CREDIT,
  type LifecycleStatus,
  type RecentGenerationView,
} from '@token-tracker/shared';
import { useQuery } from 'convex/react';

/**
 * Popup "recent generations" list (issue #18): one row per recent Generation event
 * for the current editor, newest-first, each showing its live lifecycle status.
 *
 * Presentational only (AGENTS.md §7): the data comes from the reactive Convex
 * `recentGenerations` query via `useQuery` — no fetch logic here — so rows update
 * in real time as status polls and refunds land, with no manual refresh. The
 * component receives the editor's Active organization + login and renders whatever
 * the hook returns.
 *
 * The status is conveyed by a text label, never colour alone (AGENTS.md §7
 * accessibility): the glyph is decorative (`aria-hidden`) and every row carries the
 * status word.
 */
export function RecentGenerations({
  organizationId,
  userId,
}: {
  organizationId: string | null;
  userId: string | null;
}) {
  // `useQuery` skips entirely until the editor's org + login are known, so we never
  // issue an unscoped read (ADR-0004 — every query is org-scoped).
  const generations = useQuery(
    recentGenerationsRef,
    organizationId && userId ? { organizationId, userId } : 'skip',
  );

  return (
    <section aria-label="Recent generations" className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Recent generations
      </h2>
      <RecentGenerationsBody generations={generations} />
    </section>
  );
}

/** The list body — split out so the loading / empty / populated states read clearly. */
function RecentGenerationsBody({
  generations,
}: {
  generations: RecentGenerationView[] | undefined;
}) {
  if (generations === undefined) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }
  if (generations.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No generations yet — they appear here the moment one is captured.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {generations.map((generation) => (
        <GenerationRow key={generation.id} generation={generation} />
      ))}
    </ul>
  );
}

/**
 * How each lifecycle status renders: a decorative glyph plus the status word. The
 * word is what conveys meaning (colour/glyph are secondary), so a screen reader or
 * a colour-blind editor reads the same signal (AGENTS.md §7).
 */
const STATUS_PRESENTATION: Record<LifecycleStatus, { glyph: string; label: string }> = {
  tracked: { glyph: '•', label: 'Tracked' },
  generating: { glyph: '⟳', label: 'Generating…' },
  generated: { glyph: '✓', label: 'Generated' },
  refunded: { glyph: '↺', label: 'Refunded' },
  flagged: { glyph: '⚠', label: 'Flagged' },
};

/** Internal cost units → displayed credits (ADR-0005: displayed = internal ÷ 100). */
function toCredits(internalCost: number): string {
  const credits = internalCost / INTERNAL_UNITS_PER_CREDIT;
  // Trim a trailing ".00" but keep genuine fractional credits (e.g. 12.5).
  return Number.isInteger(credits) ? String(credits) : credits.toFixed(2);
}

/** One row: prompt (or tool), its live status label, and the Cost / credited figure. */
function GenerationRow({ generation }: { generation: RecentGenerationView }) {
  const presentation = STATUS_PRESENTATION[generation.status];
  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-border p-2">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-xs font-medium text-foreground">
          {generation.prompt ?? generation.tool}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {/* Decorative glyph; the label word carries the meaning (not colour). */}
          <span aria-hidden="true">{presentation.glyph} </span>
          {presentation.label}
          {generation.status === 'generating' && generation.jobCount > 0 ? (
            <span>
              {' '}
              · {generation.completedCount} of {generation.jobCount} rendered
            </span>
          ) : null}
        </p>
      </div>
      <RowFigure generation={generation} />
    </li>
  );
}

/**
 * The right-hand figure: the Cost once generated, or the credited-back amount and
 * an explicit "net 0" once refunded (refunds net out — AGENTS.md §6). Other states
 * show nothing there yet.
 */
function RowFigure({ generation }: { generation: RecentGenerationView }) {
  if (generation.status === 'refunded' && generation.refund.kind === 'refunded') {
    return (
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-foreground">
          +{toCredits(generation.refund.amount)} credited
        </p>
        <p className="text-[11px] text-muted-foreground">net 0</p>
      </div>
    );
  }
  if (generation.status === 'generated') {
    return (
      <p className="shrink-0 text-xs font-medium text-foreground">
        {toCredits(generation.cost)} credits
      </p>
    );
  }
  return null;
}
