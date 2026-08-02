'use client';

import type { GenerationView } from '@/lib/convex';
import { netCost, toCredits } from '@/lib/credits';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GalleryAsset, GalleryData } from './types';

/**
 * The Registrar's Accession Desk — the Generation Gallery's presentational
 * surface (issue #7, design brief `.scratch/generation-gallery/brief.md`).
 *
 * The intake tray of unattributed generations leads; collections (Assets) and the
 * ledger tally frame it. Triage is keyboard-first (a first-class batch path, not
 * an afterthought): the editor moves through the tray, picks a collection, and
 * the "accession stamp" files the object — the ledger increments and focus
 * advances to the next object. The stamp motion degrades under reduced motion.
 *
 * Each tray object and collection is a native `<button>` (roving tabindex,
 * `aria-pressed` for selection) — semantic and keyboard-operable without ARIA
 * grid/listbox roles. shadcn/ui is not yet scaffolded in the dashboard (no
 * `components/ui`, no theme tokens in `globals.css`); mirroring the extension
 * popup, this uses native controls + Tailwind and defers adopting shadcn
 * primitives until the component library lands. All data arrives via props
 * (AGENTS.md §7): no fetch logic here.
 */

/**
 * Displayed credits for a set of events (ADR-0005, applied once at the edge).
 * Aggregates NET usage — charged cost minus any refunded amount (`netCost`) —
 * never the raw `cost`: refunds net out (AGENTS.md §6), so a refunded generation
 * must not inflate a tray/ledger total.
 */
function creditsOf(events: readonly GenerationView[]): string {
  return toCredits(events.reduce((sum, e) => sum + netCost(e.cost, e.refund), 0));
}

export function GalleryView(data: GalleryData): JSX.Element {
  const { intake, feed, assets, onAssign, loading, editorName, organizationName } = data;

  // The object currently under the loupe, and the collection the stamp will file
  // it into. Both are keyed by id so they survive the tray reordering as items
  // are accessioned out from under the selection.
  const [selectedId, setSelectedId] = useState<string | null>(intake[0]?.id ?? null);
  const [targetAssetId, setTargetAssetId] = useState<string | null>(assets[0]?.assetId ?? null);
  const [announcement, setAnnouncement] = useState('');
  const [lastAccession, setLastAccession] = useState<{
    seq: number;
    assetName: string;
    brandName: string;
    credits: string;
  } | null>(null);
  const seqRef = useRef(0);

  // Roving-focus plumbing: each tray object registers its button here, and a
  // keyboard-driven selection change moves DOM focus to the newly-selected one so
  // batch triage never drops focus. Mouse selection leaves focus where it is.
  const objectRefs = useRef(new Map<string, HTMLButtonElement>());
  const keyboardNav = useRef(false);

  // Keep the selection valid as the tray shrinks: if the selected object was just
  // accessioned out (or the tray loaded), fall back to the first remaining one.
  useEffect(() => {
    if (selectedId !== null && intake.some((g) => g.id === selectedId)) return;
    setSelectedId(intake[0]?.id ?? null);
  }, [intake, selectedId]);

  // Default the target collection once assets arrive.
  useEffect(() => {
    if (targetAssetId !== null && assets.some((a) => a.assetId === targetAssetId)) return;
    setTargetAssetId(assets[0]?.assetId ?? null);
  }, [assets, targetAssetId]);

  // After a keyboard-driven selection change, follow focus to the new object.
  useEffect(() => {
    if (!keyboardNav.current) return;
    keyboardNav.current = false;
    if (selectedId === null) return;
    objectRefs.current.get(selectedId)?.focus();
  }, [selectedId]);

  const selectedIndex = intake.findIndex((g) => g.id === selectedId);

  // Per-collection tally from the editor's accessioned feed — the ledger the
  // brief calls for, keyed by Asset and reconciled from real events.
  const ledger = useMemo(
    () =>
      assets.map((asset) => {
        const events = feed.filter((e) => e.assetId === asset.assetId);
        return { asset, count: events.length, credits: creditsOf(events) };
      }),
    [assets, feed],
  );

  function moveSelection(delta: number): void {
    if (intake.length === 0) return;
    const base = selectedIndex < 0 ? 0 : selectedIndex;
    const next = Math.min(intake.length - 1, Math.max(0, base + delta));
    keyboardNav.current = true;
    setSelectedId(intake[next]?.id ?? null);
  }

  function moveTarget(delta: number): void {
    if (assets.length === 0) return;
    const current = assets.findIndex((a) => a.assetId === targetAssetId);
    const base = current < 0 ? 0 : current;
    const next = Math.min(assets.length - 1, Math.max(0, base + delta));
    setTargetAssetId(assets[next]?.assetId ?? null);
  }

  /** The accession stamp: file `event` into `asset`, then advance to the next object. */
  async function accession(
    event: GenerationView,
    asset: GalleryAsset,
    refocus: boolean,
  ): Promise<void> {
    // Choose the neighbour to land on before the tray reflows the item away.
    const idx = intake.findIndex((g) => g.id === event.id);
    const neighbour = intake[idx + 1] ?? intake[idx - 1] ?? null;

    await onAssign(event.id, asset.assetId);

    keyboardNav.current = refocus;
    setSelectedId(neighbour?.id ?? null);
    setTargetAssetId(asset.assetId);
    seqRef.current += 1;
    setLastAccession({
      seq: seqRef.current,
      assetName: asset.name,
      brandName: asset.brandName,
      credits: toCredits(netCost(event.cost, event.refund)),
    });
    setAnnouncement(
      `Generation stamped and accessioned into ${asset.name} (${asset.brandName}). Ledger updated. ${
        intake.length - 1
      } remaining in the intake tray.`,
    );
  }

  function stampInto(asset: GalleryAsset | undefined, refocus: boolean): void {
    const event = selectedIndex >= 0 ? intake[selectedIndex] : undefined;
    if (!event || !asset) return;
    void accession(event, asset, refocus);
  }

  function onObjectKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>): void {
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        e.preventDefault();
        moveSelection(1);
        return;
      case 'ArrowUp':
      case 'k':
        e.preventDefault();
        moveSelection(-1);
        return;
      case 'ArrowRight':
      case 'l':
        e.preventDefault();
        moveTarget(1);
        return;
      case 'ArrowLeft':
      case 'h':
        e.preventDefault();
        moveTarget(-1);
        return;
      case 'Enter':
      case ' ':
      case 's':
        e.preventDefault();
        stampInto(
          assets.find((a) => a.assetId === targetAssetId),
          true,
        );
        return;
      default:
        // Digit hotkeys 1..9 file the selected object straight into the Nth
        // collection — the fast batch path.
        if (/^[1-9]$/.test(e.key)) {
          const asset = assets[Number(e.key) - 1];
          if (asset) {
            e.preventDefault();
            stampInto(asset, true);
          }
        }
    }
  }

  const selected = selectedIndex >= 0 ? intake[selectedIndex] : undefined;

  return (
    <div className="min-h-screen bg-graphite text-manila">
      {/* Raking-light header — the accession bench, rendered as software. */}
      <header className="border-b border-graphite-line px-6 py-5">
        <p className="text-xs uppercase tracking-[0.2em] text-brass">
          Registrar&rsquo;s Accession Desk
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-manila">Generation Gallery</h1>
        <p className="mt-1 text-sm text-manila-dim">
          {organizationName} · {editorName} · clearing the{' '}
          <code className="text-manila">unattributed</code> intake tray
        </p>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_18rem]">
        <main className="space-y-6">
          <IntakeTray
            intake={intake}
            loading={loading}
            selectedId={selectedId}
            registerObject={(id, el) => {
              if (el) objectRefs.current.set(id, el);
              else objectRefs.current.delete(id);
            }}
            onSelect={setSelectedId}
            onObjectKeyDown={onObjectKeyDown}
          />

          <CollectionsRail
            assets={assets}
            targetAssetId={targetAssetId}
            canStamp={selected !== undefined}
            onStamp={(asset) => stampInto(asset, false)}
          />

          <CollectionContents
            asset={assets.find((a) => a.assetId === targetAssetId)}
            events={feed.filter((e) => e.assetId === targetAssetId)}
          />
        </main>

        <LedgerRail
          intakeCount={intake.length}
          intakeCredits={creditsOf(intake)}
          ledger={ledger}
          lastAccession={lastAccession}
        />
      </div>

      {/* Screen-reader running commentary for the keyboard triage flow. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

// --- Intake tray --------------------------------------------------------------

type IntakeTrayProps = {
  intake: GenerationView[];
  loading: boolean;
  selectedId: string | null;
  registerObject: (id: string, el: HTMLButtonElement | null) => void;
  onSelect: (id: string) => void;
  onObjectKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
};

function IntakeTray({
  intake,
  loading,
  selectedId,
  registerObject,
  onSelect,
  onObjectKeyDown,
}: IntakeTrayProps): JSX.Element {
  return (
    <section aria-labelledby="intake-heading">
      <div className="mb-3 flex items-baseline justify-between">
        <h2
          id="intake-heading"
          className="text-sm font-semibold uppercase tracking-wider text-brass"
        >
          Intake tray — unattributed
        </h2>
        <p className="text-xs text-manila-dim">
          <kbd className="kbd">↑</kbd>/<kbd className="kbd">↓</kbd> object ·{' '}
          <kbd className="kbd">←</kbd>/<kbd className="kbd">→</kbd> collection ·{' '}
          <kbd className="kbd">1–9</kbd>/<kbd className="kbd">Enter</kbd> stamp
        </p>
      </div>

      {loading ? (
        <p className="rounded border border-graphite-line bg-graphite-raised p-6 text-sm text-manila-dim">
          Reading the intake tray…
        </p>
      ) : intake.length === 0 ? (
        <p className="rounded border border-dashed border-graphite-line bg-graphite-raised p-8 text-center text-sm text-manila-dim">
          Intake tray clear — the accession backlog is at zero.
        </p>
      ) : (
        <ul
          aria-label="Intake tray of unattributed generations"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {intake.map((event) => (
            <li key={event.id}>
              <IntakeObject
                event={event}
                selected={event.id === selectedId}
                register={registerObject}
                onSelect={() => onSelect(event.id)}
                onKeyDown={onObjectKeyDown}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IntakeObject({
  event,
  selected,
  register,
  onSelect,
  onKeyDown,
}: {
  event: GenerationView;
  selected: boolean;
  register: (id: string, el: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  const thumb = event.media[0];
  return (
    <button
      type="button"
      ref={(el) => register(event.id, el)}
      aria-pressed={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`accession-object block w-full rounded border bg-graphite-raised p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
        selected ? 'border-brass ring-1 ring-brass' : 'border-graphite-line hover:border-brass/60'
      }`}
    >
      <span className="block aspect-[4/3] overflow-hidden rounded bg-graphite">
        {thumb ? (
          // Result media, rendered as an accessioned object under raking light.
          <img
            src={thumb}
            alt={event.prompt ?? 'Result media'}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-manila-dim">
            {event.jobCount} job{event.jobCount === 1 ? '' : 's'} rendering…
          </span>
        )}
      </span>
      <span className="mt-2 line-clamp-2 block text-sm text-manila">
        {event.prompt ?? 'No prompt captured'}
      </span>
      <span className="mt-2 flex items-center justify-between text-xs">
        <span className="rounded bg-vermilion/15 px-1.5 py-0.5 font-medium text-vermilion-ink">
          needs-assignment
        </span>
        <span className="tabular-nums text-manila-dim">
          {toCredits(netCost(event.cost, event.refund))} credits · {event.media.length}/
          {event.jobCount} media
        </span>
      </span>
    </button>
  );
}

// --- Collections rail ---------------------------------------------------------

function CollectionsRail({
  assets,
  targetAssetId,
  canStamp,
  onStamp,
}: {
  assets: GalleryAsset[];
  targetAssetId: string | null;
  canStamp: boolean;
  onStamp: (asset: GalleryAsset) => void;
}): JSX.Element {
  return (
    <section aria-labelledby="collections-heading">
      <h2
        id="collections-heading"
        className="mb-3 text-sm font-semibold uppercase tracking-wider text-brass"
      >
        Collections — accession into an Asset
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map((asset, i) => {
          const isTarget = asset.assetId === targetAssetId;
          return (
            <li key={asset.assetId}>
              <button
                type="button"
                aria-pressed={isTarget}
                disabled={!canStamp}
                onClick={() => onStamp(asset)}
                className={`flex w-full items-center gap-3 rounded border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isTarget
                    ? 'border-brass bg-brass/10'
                    : 'border-graphite-line bg-graphite-raised hover:border-brass/60'
                }`}
              >
                <kbd className="kbd shrink-0">{i + 1}</kbd>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-manila">{asset.name}</span>
                  <span className="block truncate text-xs text-manila-dim">{asset.brandName}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- Per-Asset browse ---------------------------------------------------------

function CollectionContents({
  asset,
  events,
}: {
  asset: GalleryAsset | undefined;
  events: GenerationView[];
}): JSX.Element | null {
  if (!asset) return null;
  return (
    <section aria-labelledby="contents-heading">
      <h2
        id="contents-heading"
        className="mb-3 text-sm font-semibold uppercase tracking-wider text-brass"
      >
        In {asset.name} — {asset.brandName}
      </h2>
      {events.length === 0 ? (
        <p className="rounded border border-dashed border-graphite-line bg-graphite-raised p-6 text-sm text-manila-dim">
          No generations accessioned into this collection yet.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded border border-graphite-line bg-graphite-raised p-3"
            >
              <div className="aspect-[4/3] overflow-hidden rounded bg-graphite">
                {event.media[0] ? (
                  <img
                    src={event.media[0]}
                    alt={event.prompt ?? 'Result media'}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-manila">{event.prompt ?? 'No prompt'}</p>
              <p className="mt-1 text-xs tabular-nums text-manila-dim">
                {toCredits(netCost(event.cost, event.refund))} credits
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Ledger rail --------------------------------------------------------------

function LedgerRail({
  intakeCount,
  intakeCredits,
  ledger,
  lastAccession,
}: {
  intakeCount: number;
  intakeCredits: string;
  ledger: { asset: GalleryAsset; count: number; credits: string }[];
  lastAccession: { seq: number; assetName: string; brandName: string; credits: string } | null;
}): JSX.Element {
  return (
    <aside aria-label="Accession ledger" className="space-y-4">
      <div className="rounded border border-graphite-line bg-graphite-raised p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brass">Ledger</h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-manila-dim">Awaiting assignment</dt>
            <dd className="tabular-nums text-manila">{intakeCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-manila-dim">Intake credits</dt>
            <dd className="tabular-nums text-manila">{intakeCredits}</dd>
          </div>
        </dl>

        <table className="mt-4 w-full text-sm">
          <caption className="sr-only">Accessioned credits by collection</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-manila-dim">
              <th scope="col" className="pb-1 font-medium">
                Collection
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                Credits
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-graphite-line">
            {ledger.map(({ asset, count, credits }) => (
              <tr key={asset.assetId}>
                <td className="py-1.5">
                  <span className="block truncate text-manila">{asset.name}</span>
                  <span className="block truncate text-xs text-manila-dim">{count} filed</span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-manila">{credits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The signature accession stamp: it inks vermilion on each filing and
          degrades to a static mark under reduced motion (see globals.css). */}
      {lastAccession ? (
        <div className="rounded border border-graphite-line bg-graphite-raised p-4">
          <p className="text-xs uppercase tracking-wider text-manila-dim">Last accession</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="stamp-mark" aria-hidden="true">
              №{lastAccession.seq}
            </span>
            <div className="text-sm">
              <p className="text-manila">{lastAccession.assetName}</p>
              <p className="text-xs text-manila-dim">
                {lastAccession.brandName} · {lastAccession.credits} credits
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
