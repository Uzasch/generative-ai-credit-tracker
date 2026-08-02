import { expect, test } from 'vitest';
import { CATALOG, resolveAssetBrand } from './catalog';

// Pure catalog resolution — no database (AGENTS.md §9), so it runs without the
// convex `_generated` files. This is the Asset↔Brand↔Org membership check the
// `assignAsset` write boundary relies on to heal a stale brandId and to reject
// cross-org / cross-brand targets.

test('resolveAssetBrand returns the owning Brand of an Asset within its Organization', () => {
  expect(resolveAssetBrand('org_northwind', 'asset_aurora_teaser')).toBe('brand_aurora');
  expect(resolveAssetBrand('org_northwind', 'asset_aurora_hero')).toBe('brand_aurora');
  expect(resolveAssetBrand('org_northwind', 'asset_vertex_reel')).toBe('brand_vertex');
  expect(resolveAssetBrand('org_globex', 'asset_pulse_banner')).toBe('brand_pulse');
});

test('resolveAssetBrand rejects an Asset that belongs to a different Organization', () => {
  // Pulse is Globex's Asset; asking for it under Northwind must not resolve — the
  // stale-brandId fix depends on this refusing cross-org targets.
  expect(resolveAssetBrand('org_northwind', 'asset_pulse_banner')).toBeNull();
  expect(resolveAssetBrand('org_globex', 'asset_aurora_teaser')).toBeNull();
});

test('resolveAssetBrand rejects an unknown Asset id', () => {
  expect(resolveAssetBrand('org_northwind', 'asset_nonexistent')).toBeNull();
});

test('resolveAssetBrand rejects an unknown Organization', () => {
  expect(resolveAssetBrand('org_unknown', 'asset_aurora_teaser')).toBeNull();
});

test('resolveAssetBrand never resolves the unattributed sentinel to a Brand', () => {
  // The sentinel is not an Asset; assignAsset refuses it before resolution, but
  // the resolver must not accidentally map it to a Brand either.
  expect(resolveAssetBrand('org_northwind', 'unattributed')).toBeNull();
});

test('every catalog Asset resolves to exactly the Brand that lists it', () => {
  // Guards the resolver against catalog drift: each Asset maps back to its Brand.
  for (const org of CATALOG.orgs) {
    for (const brand of org.brands) {
      for (const asset of brand.assets) {
        expect(resolveAssetBrand(org.organizationId, asset.assetId)).toBe(brand.brandId);
      }
    }
  }
});
