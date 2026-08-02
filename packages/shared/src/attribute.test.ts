import { describe, expect, it } from 'vitest';
import {
  type ActiveContext,
  type ExtractedGeneration,
  attribute,
  isFlaggedAnomaly,
} from './attribute';

/** A representative Higgsfield extraction: a paid image generation, two jobs. */
const extracted: ExtractedGeneration = {
  tool: 'higgsfield',
  cost: 500,
  prompt: 'a red bicycle',
  jobIds: ['job_a', 'job_b'],
  toolRef: 'jobset_123',
  capturedAt: 1_700_000_000_000,
  ruleVersion: 1,
};

/** An editor who has picked an Active Asset. */
const withAsset: ActiveContext = {
  organizationId: 'org_1',
  userId: 'user_ada',
  brandId: 'brand_acme',
  assetId: 'asset_song_1',
  toolAccount: 'aibusiness@studio.example',
};

describe('attribute', () => {
  it('with an Active Asset ⇒ a fully-stamped GenerationEvent', () => {
    const result = attribute(extracted, withAsset);

    expect(isFlaggedAnomaly(result)).toBe(false);
    // Narrow for the type checker; the assertion above is the real gate.
    if (isFlaggedAnomaly(result)) throw new Error('expected a GenerationEvent');

    expect(result).toStrictEqual({
      organizationId: 'org_1',
      userId: 'user_ada',
      brandId: 'brand_acme',
      assetId: 'asset_song_1',
      tool: 'higgsfield',
      cost: 500,
      prompt: 'a red bicycle',
      jobs: [
        { jobId: 'job_a', status: 'queued' },
        { jobId: 'job_b', status: 'queued' },
      ],
      refund: { kind: 'none' },
      capturedAt: 1_700_000_000_000,
      toolRef: 'jobset_123',
      toolAccount: 'aibusiness@studio.example',
      ruleVersion: 1,
    });
  });

  it('with no Active Asset ⇒ a needs-assignment FlaggedAnomaly wrapping an unattributed event', () => {
    const noAsset: ActiveContext = { ...withAsset, assetId: null };

    const result = attribute(extracted, noAsset);

    expect(isFlaggedAnomaly(result)).toBe(true);
    if (!isFlaggedAnomaly(result)) throw new Error('expected a FlaggedAnomaly');

    expect(result.kind).toBe('needs-assignment');
    expect(result.reason).toMatch(/active asset/i);
    // The charge is never lost: the flagged anomaly carries the real event.
    expect(result.event.assetId).toBe('unattributed');
    expect(result.event.cost).toBe(500);
    // Identity and brand are still stamped — only the asset is missing.
    expect(result.event.organizationId).toBe('org_1');
    expect(result.event.userId).toBe('user_ada');
    expect(result.event.brandId).toBe('brand_acme');
  });

  it('maps every extracted job id to a freshly-queued job (ADR-0002: outcomes are observed later, not invented)', () => {
    const result = attribute({ ...extracted, jobIds: ['j1', 'j2', 'j3'] }, withAsset);
    if (isFlaggedAnomaly(result)) throw new Error('expected a GenerationEvent');

    expect(result.jobs).toStrictEqual([
      { jobId: 'j1', status: 'queued' },
      { jobId: 'j2', status: 'queued' },
      { jobId: 'j3', status: 'queued' },
    ]);
  });

  it('defaults refund to { kind: none } and passes a supplied refund through', () => {
    const noRefund = attribute(extracted, withAsset);
    if (isFlaggedAnomaly(noRefund)) throw new Error('expected a GenerationEvent');
    expect(noRefund.refund).toStrictEqual({ kind: 'none' });

    const pending = attribute({ ...extracted, refund: { kind: 'pending' } }, withAsset);
    if (isFlaggedAnomaly(pending)) throw new Error('expected a GenerationEvent');
    expect(pending.refund).toStrictEqual({ kind: 'pending' });
  });

  it('omits toolAccount when the context has none (ADR-0004: metadata only, never required)', () => {
    const { toolAccount: _drop, ...withoutSeat } = withAsset;
    const result = attribute(extracted, withoutSeat);
    if (isFlaggedAnomaly(result)) throw new Error('expected a GenerationEvent');
    expect(result.toolAccount).toBeUndefined();
  });
});
