import type { GalleryAsset } from '@/components/gallery/types';
import type { GenerationView } from '@/lib/convex';

/**
 * Clearly-synthetic seed data for the Generation Gallery (issue #7 requires
 * placeholder data only — no fabricated real usage figures, editor names, or
 * brand/asset examples). Every label is overtly a placeholder. Result media are
 * self-contained inline SVG data URIs (no network, honoring the extension's
 * "no external fetch" posture), rendered as accessioned objects under raking
 * light. Used when `NEXT_PUBLIC_CONVEX_URL` is unset so the surface and its
 * keyboard triage are fully operable without a live deployment.
 */

/** A tiny accessioned-object thumbnail as an inline SVG data URI. */
function objectThumb(hue: number, glyph: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 24% 30%)"/>
      <stop offset="1" stop-color="hsl(${hue} 20% 16%)"/>
    </linearGradient>
  </defs>
  <rect width="160" height="120" fill="url(#g)"/>
  <rect x="8" y="8" width="144" height="104" fill="none" stroke="#B08948" stroke-width="1" opacity="0.5"/>
  <text x="80" y="70" font-family="Georgia, serif" font-size="40" fill="#E8E1CE" text-anchor="middle" opacity="0.85">${glyph}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const PLACEHOLDER_ORG = 'Placeholder Organization (synthetic)';
export const PLACEHOLDER_EDITOR = 'Editor One (synthetic)';

export const PLACEHOLDER_ASSETS: GalleryAsset[] = [
  {
    assetId: 'asset_ph_1',
    name: 'Placeholder Asset A',
    brandId: 'brand_ph_1',
    brandName: 'Placeholder Brand One',
  },
  {
    assetId: 'asset_ph_2',
    name: 'Placeholder Asset B',
    brandId: 'brand_ph_1',
    brandName: 'Placeholder Brand One',
  },
  {
    assetId: 'asset_ph_3',
    name: 'Placeholder Asset C',
    brandId: 'brand_ph_2',
    brandName: 'Placeholder Brand Two',
  },
];

/** Costs use the internal unit (ADR-0005): 100 / 500 / 750 mirror observed Higgsfield values. */
function synthetic(
  id: string,
  prompt: string,
  cost: number,
  hue: number,
  glyph: string,
  jobCount = 1,
  // Defaults to no refund; pass a `refunded` state to exercise net aggregation
  // (a refunded generation must net out of the tray/ledger totals).
  refund: GenerationView['refund'] = { kind: 'none' },
): GenerationView {
  return {
    id,
    tool: 'higgsfield',
    userId: 'user_ph_editor',
    brandId: 'brand_ph_1',
    assetId: 'unattributed',
    assignment: { status: 'needs-assignment' },
    prompt,
    cost,
    refund,
    // Synthetic thumbnails are inline SVG data URIs — still images (kind 'image');
    // the projection tags real captures image|video from the media URL.
    media: [{ url: objectThumb(hue, glyph), kind: 'image' }],
    jobCount,
    capturedAt: 0,
  };
}

/** The synthetic intake tray — unattributed generations awaiting Assignment. */
export const PLACEHOLDER_INTAKE: GenerationView[] = [
  synthetic('ph_evt_1', 'Synthetic prompt — raking light across a graphite bench', 100, 20, '▲'),
  synthetic(
    'ph_evt_2',
    'Synthetic prompt — accessioned object, three-quarter view',
    500,
    40,
    '●',
    4,
  ),
  // A fully-refunded generation (e.g. an nsfw terminal): its 750 cost nets to 0,
  // so it must not inflate the intake-tray credit total (refunds net out).
  synthetic('ph_evt_3', 'Synthetic prompt — vermilion stamp on a manila label', 750, 8, '■', 1, {
    kind: 'refunded',
    amount: 750,
    at: 0,
  }),
  synthetic('ph_evt_4', 'Synthetic prompt — brass fitting under a loupe', 100, 200, '◆'),
  synthetic('ph_evt_5', 'Synthetic prompt — intake tray, overhead study', 500, 120, '✦', 2),
];

/** A couple of already-accessioned generations, so the per-Editor feed is not empty. */
export const PLACEHOLDER_FEED: GenerationView[] = [
  {
    id: 'ph_evt_done_1',
    tool: 'higgsfield',
    userId: 'user_ph_editor',
    brandId: 'brand_ph_1',
    assetId: 'asset_ph_1',
    assignment: { status: 'assigned' },
    prompt: 'Synthetic prompt — filed study, catalogued last session',
    cost: 500,
    refund: { kind: 'none' },
    media: [{ url: objectThumb(30, '❖'), kind: 'image' }],
    jobCount: 1,
    capturedAt: 0,
  },
];
