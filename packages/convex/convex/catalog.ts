import type { SeedCatalog } from '@token-tracker/shared';

/**
 * Hardcoded selection catalog for issue #5. Real Org / Brand / Asset / User CRUD
 * is out of scope, so the popup's Org → Brand → Asset picker and its minimal
 * login roster are served from this constant rather than persisted tables. Every
 * generation is scoped to exactly one Organization (ADR-0004), and each Org owns
 * its own logins — seeding two orgs exercises the picker's branching without
 * weakening per-org isolation (an editor under one Org is a distinct login from
 * the same person under another). The shared tool seat is NOT seeded here: it is
 * captured from the tool's own traffic as metadata (ADR-0004), never chosen.
 *
 * Kept in this pure, `_generated`-free module (like `rollups.ts` / `gallery.ts`)
 * so both the `seed:catalog` query and the `assignAsset` write boundary can read
 * it, and the Asset→Brand resolver below stays unit-testable directly.
 */
export const CATALOG: SeedCatalog = {
  orgs: [
    {
      organizationId: 'org_northwind',
      name: 'Northwind Studios',
      users: [
        { userId: 'user_ada', displayName: 'Ada (Editor)' },
        { userId: 'user_grace', displayName: 'Grace (Editor)' },
      ],
      brands: [
        {
          brandId: 'brand_aurora',
          name: 'Aurora',
          assets: [
            { assetId: 'asset_aurora_teaser', name: 'Aurora — Launch Teaser' },
            { assetId: 'asset_aurora_hero', name: 'Aurora — Hero Image' },
          ],
        },
        {
          brandId: 'brand_vertex',
          name: 'Vertex',
          assets: [{ assetId: 'asset_vertex_reel', name: 'Vertex — Product Reel' }],
        },
      ],
    },
    {
      organizationId: 'org_globex',
      name: 'Globex Media',
      users: [{ userId: 'user_hopper', displayName: 'Hopper (Editor)' }],
      brands: [
        {
          brandId: 'brand_pulse',
          name: 'Pulse',
          assets: [{ assetId: 'asset_pulse_banner', name: 'Pulse — Campaign Banner' }],
        },
      ],
    },
  ],
};

/**
 * Resolve an Asset to its owning Brand *within one Organization*, from the seed
 * catalog (the Asset↔Brand↔Org source of truth while real entity CRUD is out of
 * scope, issue #5). Returns the `brandId`, or `null` when no Asset with that id
 * exists under that Organization — i.e. the Asset is unknown, or belongs to a
 * different Organization or Brand.
 *
 * The `assignAsset` write boundary uses this to stamp the target Asset's real
 * Brand onto the event (never leaving a stale capture-time `brandId`) and to
 * reject cross-org / cross-brand targets. Pure and `_generated`-free so it is
 * unit-testable directly (AGENTS.md §9).
 */
export function resolveAssetBrand(organizationId: string, assetId: string): string | null {
  const org = CATALOG.orgs.find((o) => o.organizationId === organizationId);
  if (org === undefined) return null;
  for (const brand of org.brands) {
    if (brand.assets.some((asset) => asset.assetId === assetId)) return brand.brandId;
  }
  return null;
}
