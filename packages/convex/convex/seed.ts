import type { SeedCatalog } from '@token-tracker/shared';
import { query } from './_generated/server';

/**
 * Hardcoded selection catalog for issue #5. Real Org / Brand / Asset / User CRUD
 * is out of scope, so the popup's Org → Brand → Asset picker and its minimal
 * login roster are served from this constant rather than persisted tables. Every
 * generation is still scoped to exactly one Organization (ADR-0004); seeding two
 * orgs only makes the picker exercise real branching — it does not weaken
 * per-org isolation, which the `events` roll-up queries enforce.
 */
const CATALOG: SeedCatalog = {
  users: [
    { userId: 'user_ada', displayName: 'Ada (Editor)' },
    { userId: 'user_grace', displayName: 'Grace (Editor)' },
  ],
  orgs: [
    {
      organizationId: 'org_northwind',
      name: 'Northwind Studios',
      toolAccount: 'aibusiness@northwind.example',
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
      toolAccount: 'aibusiness@globex.example',
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
 * The hardcoded Org → Brand → Asset + login catalog the popup selects from.
 * Read-only and args-free: it reads no tables and never writes.
 */
export const catalog = query({
  args: {},
  handler: async (): Promise<SeedCatalog> => CATALOG,
});
