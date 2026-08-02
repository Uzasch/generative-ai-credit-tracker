import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// convex-test loads every function module in this directory in-memory.
const modules = import.meta.glob('./**/*.*s');

test('seed catalog serves a non-empty Org → Brand → Asset tree plus a login roster', async () => {
  const t = convexTest(schema, modules);

  const catalog = await t.query(api.seed.catalog, {});

  expect(catalog.users.length).toBeGreaterThan(0);
  expect(catalog.orgs.length).toBeGreaterThan(0);
  // Every org has at least one brand, and every brand at least one asset — the
  // popup's cascading picker relies on each level being non-empty.
  for (const org of catalog.orgs) {
    expect(org.brands.length).toBeGreaterThan(0);
    for (const brand of org.brands) {
      expect(brand.assets.length).toBeGreaterThan(0);
    }
  }
});

test('seed catalog ids are unique so a selection maps to exactly one entity', async () => {
  const t = convexTest(schema, modules);

  const catalog = await t.query(api.seed.catalog, {});

  const userIds = catalog.users.map((u) => u.userId);
  const orgIds = catalog.orgs.map((o) => o.organizationId);
  const brandIds = catalog.orgs.flatMap((o) => o.brands.map((b) => b.brandId));
  const assetIds = catalog.orgs.flatMap((o) =>
    o.brands.flatMap((b) => b.assets.map((a) => a.assetId)),
  );

  expect(new Set(userIds).size).toBe(userIds.length);
  expect(new Set(orgIds).size).toBe(orgIds.length);
  expect(new Set(brandIds).size).toBe(brandIds.length);
  expect(new Set(assetIds).size).toBe(assetIds.length);
});
