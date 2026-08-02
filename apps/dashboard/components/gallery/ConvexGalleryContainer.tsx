'use client';

import {
  assignAssetRef,
  generationsByAssetRef,
  generationsByUserRef,
  seedCatalogRef,
  unattributedGenerationsRef,
} from '@/lib/convex';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';
import { GalleryView } from './GalleryView';
import type { GalleryAsset } from './types';

/**
 * The gallery backed by live Convex queries + the `assignAsset` mutation. Mounted
 * only inside a `ConvexProvider` (see `app/providers.tsx`), which the page renders
 * only when `NEXT_PUBLIC_CONVEX_URL` is configured. Assignment goes through the
 * single Convex mutation (AGENTS.md §6) and the tray/feed update reactively.
 *
 * Identity (which Organization/editor) comes from auth in production — out of
 * scope here (issue #5/#7). Until that lands, the surface targets the first org
 * and editor in the read-only seed catalog so the page is operable against a
 * seeded deployment without inventing an auth flow.
 */
export function ConvexGalleryContainer(): JSX.Element {
  const catalog = useQuery(seedCatalogRef, {});
  const org = catalog?.orgs[0];
  const organizationId = org?.organizationId;
  const editor = org?.users[0];
  const userId = editor?.userId;

  const assets = useMemo<GalleryAsset[]>(() => {
    if (!org) return [];
    return org.brands.flatMap((brand) =>
      brand.assets.map((asset) => ({
        assetId: asset.assetId,
        name: asset.name,
        brandId: brand.brandId,
        brandName: brand.name,
      })),
    );
  }, [org]);

  // Intake is per-editor, same as the feed: scope it by org AND user so an editor
  // only sees their own unattributed work (ADR-0004).
  const intake = useQuery(
    unattributedGenerationsRef,
    organizationId && userId ? { organizationId, userId } : 'skip',
  );
  const feed = useQuery(
    generationsByUserRef,
    organizationId && userId ? { organizationId, userId } : 'skip',
  );

  // The Asset the gallery's collection view is browsing, reported up from the
  // presentational surface. The per-Asset view aggregates across ALL editors
  // (Assets aggregate across Users — CONTEXT.md), so it reads the org-scoped
  // `generationsByAsset` query — NOT a filter of this editor's feed, which would
  // hide other editors' generations for the same Asset. Skip until an Asset is
  // selected, and never pass the `'unattributed'` sentinel (that query refuses it;
  // the intake tray covers unattributed work).
  const [viewedAssetId, setViewedAssetId] = useState<string | null>(null);
  const assetGenerations = useQuery(
    generationsByAssetRef,
    organizationId && viewedAssetId && viewedAssetId !== 'unattributed'
      ? { organizationId, assetId: viewedAssetId }
      : 'skip',
  );

  const assign = useMutation(assignAssetRef);

  const onAssign = useCallback(
    async (eventId: string, assetId: string) => {
      if (!organizationId) return;
      await assign({ organizationId, eventId, assetId });
    },
    [assign, organizationId],
  );

  return (
    <GalleryView
      organizationName={org?.name ?? 'Loading…'}
      editorName={editor?.displayName ?? 'Loading…'}
      intake={intake ?? []}
      feed={feed ?? []}
      assetGenerations={assetGenerations ?? []}
      assets={assets}
      loading={catalog === undefined || intake === undefined || feed === undefined}
      onAssign={onAssign}
      onViewAsset={setViewedAssetId}
    />
  );
}
