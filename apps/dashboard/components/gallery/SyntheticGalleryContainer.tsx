'use client';

import type { GenerationView } from '@/lib/convex';
import {
  PLACEHOLDER_ASSETS,
  PLACEHOLDER_EDITOR,
  PLACEHOLDER_FEED,
  PLACEHOLDER_INTAKE,
  PLACEHOLDER_ORG,
} from '@/lib/placeholder';
import { useCallback, useMemo, useState } from 'react';
import { GalleryView } from './GalleryView';

/**
 * The gallery driven by clearly-synthetic placeholder data (issue #7 mandates
 * placeholder-only data during design/build). Used when `NEXT_PUBLIC_CONVEX_URL`
 * is unset, so the Registrar surface and its keyboard triage are fully operable
 * with no live Convex deployment. Assignment mutates local state — the same
 * transition `assignAsset` performs server-side: the object leaves the intake
 * tray and joins the editor's accessioned feed under the chosen Asset.
 */
export function SyntheticGalleryContainer(): JSX.Element {
  const [intake, setIntake] = useState<GenerationView[]>(PLACEHOLDER_INTAKE);
  const [feed, setFeed] = useState<GenerationView[]>(PLACEHOLDER_FEED);

  // The collection view aggregates an Asset's generations across all editors. The
  // synthetic surface has a single editor, so its "all editors" is just the feed
  // filtered to the browsed Asset (reported up via onViewAsset) — mirroring what
  // the Convex container gets from the org-scoped `generationsByAsset` query.
  const [viewedAssetId, setViewedAssetId] = useState<string | null>(null);
  const assetGenerations = useMemo(
    () => feed.filter((g) => g.assetId === viewedAssetId),
    [feed, viewedAssetId],
  );

  const onAssign = useCallback((eventId: string, assetId: string) => {
    setIntake((tray) => {
      const event = tray.find((g) => g.id === eventId);
      if (!event) return tray;
      // Move it out of the tray and into the feed, filed under the Asset with its
      // needs-assignment flag resolved — mirroring the server transition.
      setFeed((current) => [{ ...event, assetId, assignment: { status: 'assigned' } }, ...current]);
      return tray.filter((g) => g.id !== eventId);
    });
  }, []);

  return (
    <GalleryView
      organizationName={PLACEHOLDER_ORG}
      editorName={PLACEHOLDER_EDITOR}
      intake={intake}
      feed={feed}
      assetGenerations={assetGenerations}
      assets={PLACEHOLDER_ASSETS}
      loading={false}
      onAssign={onAssign}
      onViewAsset={setViewedAssetId}
    />
  );
}
