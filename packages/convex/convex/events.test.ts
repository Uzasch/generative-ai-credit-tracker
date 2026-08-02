import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// convex-test loads every function module in this directory in-memory.
const modules = import.meta.glob('./**/*.*s');

const ORG = 'org_studio';

// Derived from the canonical `record` validator so the test can't drift from
// the event shape (AGENTS.md §2 — never re-declare cross-cutting types).
type EventInput = FunctionArgs<typeof api.events.record>;

/** A fully-attributed Higgsfield event; override only what a test cares about. */
function eventArgs(overrides: Partial<EventInput> = {}): EventInput {
  return {
    organizationId: ORG,
    userId: 'user_a',
    tool: 'higgsfield',
    brandId: 'brand_x',
    assetId: 'asset_1',
    cost: 100,
    capturedAt: 1,
    ruleVersion: 1,
    ...overrides,
  };
}

test('net for an asset is the sum of its charges when nothing is refunded', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ cost: 100 }));
  await t.mutation(api.events.record, eventArgs({ cost: 500 }));

  const usage = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  expect(usage.net).toBe(600);
});

test('a refunded event reduces the asset total by the refunded amount', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ cost: 500 }));
  await t.mutation(
    api.events.record,
    eventArgs({ cost: 500, refund: { kind: 'refunded', amount: 200, at: 2 } }),
  );

  const usage = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  // 500 charged + (500 charged − 200 refunded) = 800
  expect(usage.net).toBe(800);
});

test('a fully refunded event nets out of the total', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(
    api.events.record,
    eventArgs({ cost: 750, refund: { kind: 'refunded', amount: 750, at: 2 } }),
  );

  const usage = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  expect(usage.net).toBe(0);
});

test('an unattributed event is excluded from any asset total but counts at brand and org level', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'asset_1', cost: 100 }));
  await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed', cost: 500 }));

  const asset = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  const brand = await t.query(api.events.usageByBrand, { organizationId: ORG, brandId: 'brand_x' });
  const org = await t.query(api.events.usageByOrg, { organizationId: ORG });

  expect(asset.net).toBe(100); // unattributed excluded from the asset
  expect(brand.net).toBe(600); // but included at the brand
  expect(org.net).toBe(600); // and the org
});

test("the 'unattributed' sentinel cannot be queried as an asset total", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed', cost: 500 }));

  // 'unattributed' is not an Asset, so an Asset roll-up must refuse it rather
  // than report its credits as an asset total.
  await expect(
    t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'unattributed' }),
  ).rejects.toThrow(/not an Asset/);
});

test('per-user usage is an independent axis from asset/brand', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ userId: 'user_a', cost: 100 }));
  await t.mutation(api.events.record, eventArgs({ userId: 'user_a', cost: 300 }));
  await t.mutation(api.events.record, eventArgs({ userId: 'user_b', cost: 500 }));

  const a = await t.query(api.events.usageByUser, { organizationId: ORG, userId: 'user_a' });
  const b = await t.query(api.events.usageByUser, { organizationId: ORG, userId: 'user_b' });
  expect(a.net).toBe(400);
  expect(b.net).toBe(500);
});

test('roll-ups are isolated per organization', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ organizationId: ORG, cost: 100 }));
  await t.mutation(api.events.record, eventArgs({ organizationId: 'org_other', cost: 999 }));

  const mine = await t.query(api.events.usageByOrg, { organizationId: ORG });
  const asset = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'asset_1' });
  expect(mine.net).toBe(100); // the other org's 999 is not visible
  expect(asset.net).toBe(100);
});

// The write boundary enforces AGENTS.md §6: the assignment flag mirrors the
// `'unattributed'` assetId sentinel, so a contradictory event can never persist.

test('an unattributed event is stored needs-assignment even when assignment is omitted', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'unattributed', brandId: 'brand_x' }));

  // usageByBrand includes unattributed events; usageByAsset refuses the sentinel.
  const brand = await t.query(api.events.usageByBrand, { organizationId: ORG, brandId: 'brand_x' });
  expect(brand.events).toHaveLength(1);
  expect(brand.events[0]?.assignment).toStrictEqual({ status: 'needs-assignment' });
});

test('a real Asset event is stored assigned', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.events.record, eventArgs({ assetId: 'asset_1', brandId: 'brand_x' }));

  const brand = await t.query(api.events.usageByBrand, { organizationId: ORG, brandId: 'brand_x' });
  expect(brand.events[0]?.assignment).toStrictEqual({ status: 'assigned' });
});

test('record rejects an assignment that contradicts the assetId', async () => {
  const t = convexTest(schema, modules);

  // unattributed asset must not pair with 'assigned'
  await expect(
    t.mutation(
      api.events.record,
      eventArgs({ assetId: 'unattributed', assignment: { status: 'assigned' } }),
    ),
  ).rejects.toThrow(/contradicts assetId/);

  // a real Asset must not pair with 'needs-assignment'
  await expect(
    t.mutation(
      api.events.record,
      eventArgs({ assetId: 'asset_1', assignment: { status: 'needs-assignment' } }),
    ),
  ).rejects.toThrow(/contradicts assetId/);
});
