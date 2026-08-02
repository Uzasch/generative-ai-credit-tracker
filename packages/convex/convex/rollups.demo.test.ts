import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import { sumNet } from './rollups';
import schema from './schema';

// Demo (issue #6, criterion 4): totals are queryable per asset / brand / org /
// user, and every total reconciles against the underlying events it returns.
// Run with `pnpm --filter @token-tracker/convex test`.

const modules = import.meta.glob('./**/*.*s');
const ORG = 'org_studio';

test('demo: all four roll-up axes reconcile against the underlying events', async () => {
  const t = convexTest(schema, modules);

  // A realistic slice: two brands, two editors, a partial refund, and one
  // unattributed generation with no Active Asset.
  const base = { tool: 'higgsfield' as const, organizationId: ORG, capturedAt: 1, ruleVersion: 1 };
  await t.mutation(api.events.record, {
    ...base,
    userId: 'user_ann',
    brandId: 'brand_alpha',
    assetId: 'song_1',
    cost: 100,
  });
  await t.mutation(api.events.record, {
    ...base,
    userId: 'user_ann',
    brandId: 'brand_alpha',
    assetId: 'song_1',
    cost: 500,
    refund: { kind: 'refunded', amount: 200, at: 2 },
  });
  await t.mutation(api.events.record, {
    ...base,
    userId: 'user_ben',
    brandId: 'brand_alpha',
    assetId: 'song_1',
    cost: 750,
  });
  await t.mutation(api.events.record, {
    ...base,
    userId: 'user_ben',
    brandId: 'brand_beta',
    assetId: 'video_2',
    cost: 500,
  });
  await t.mutation(api.events.record, {
    ...base,
    userId: 'user_ann',
    brandId: 'brand_beta',
    assetId: 'unattributed',
    cost: 100,
  });

  const song = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'song_1' });
  const video = await t.query(api.events.usageByAsset, { organizationId: ORG, assetId: 'video_2' });
  const alpha = await t.query(api.events.usageByBrand, {
    organizationId: ORG,
    brandId: 'brand_alpha',
  });
  const beta = await t.query(api.events.usageByBrand, {
    organizationId: ORG,
    brandId: 'brand_beta',
  });
  const org = await t.query(api.events.usageByOrg, { organizationId: ORG });
  const ann = await t.query(api.events.usageByUser, { organizationId: ORG, userId: 'user_ann' });
  const ben = await t.query(api.events.usageByUser, { organizationId: ORG, userId: 'user_ben' });

  // Every reported net equals the net re-derived from the events it returned.
  for (const usage of [song, video, alpha, beta, org, ann, ben]) {
    expect(usage.net).toBe(sumNet(usage.events));
  }

  // And the hand-computed expectations hold.
  expect(song.net).toBe(1150); // 100 + (500 − 200) + 750
  expect(video.net).toBe(500);
  expect(alpha.net).toBe(1150); // song_1 only
  expect(beta.net).toBe(600); // video_2 (500) + unattributed (100)
  expect(ann.net).toBe(500); // 100 + 300 + 100
  expect(ben.net).toBe(1250); // 750 + 500
  expect(org.net).toBe(1750);

  // Roll-up identities: brands sum to org, users sum to org.
  expect(alpha.net + beta.net).toBe(org.net);
  expect(ann.net + ben.net).toBe(org.net);
  // The unattributed 100 is in the brand/org totals but in neither asset total.
  expect(song.net + video.net).toBe(org.net - 100);

  // Values are internal cost units (the stored `cost`). Displayed credits are
  // internal / 100 at the presentation layer only (ADR-0005) — not applied here.
  console.log(
    `\nNet usage roll-up demo (internal cost units):
  org ${ORG}: ${org.net}
    brand_alpha: ${alpha.net}   brand_beta: ${beta.net}
    asset song_1: ${song.net}   asset video_2: ${video.net}
    user_ann: ${ann.net}   user_ben: ${ben.net}
  (100 unattributed cost units roll up to brand_beta/org, to no asset)
`,
  );
});
