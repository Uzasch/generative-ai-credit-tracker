import { expect, test } from 'vitest';
import { eventNet, sumNet } from './rollups';

// Pure roll-up math — no database. Exercises the netting rule in isolation
// (AGENTS.md §9): a refunded event still contributes its charged cost, reduced
// by the refunded amount.

test('eventNet returns the full cost when nothing was refunded', () => {
  expect(eventNet({ cost: 100, refund: { kind: 'none' } })).toBe(100);
});

test('eventNet ignores a pending refund (no amount reversed yet)', () => {
  expect(eventNet({ cost: 500, refund: { kind: 'pending' } })).toBe(500);
});

test('eventNet subtracts a refunded amount', () => {
  expect(eventNet({ cost: 500, refund: { kind: 'refunded', amount: 200, at: 1 } })).toBe(300);
});

test('eventNet nets a fully refunded event to zero', () => {
  expect(eventNet({ cost: 750, refund: { kind: 'refunded', amount: 750, at: 1 } })).toBe(0);
});

test('sumNet of no events is zero', () => {
  expect(sumNet([])).toBe(0);
});

test('sumNet adds charges and subtracts refunds across events', () => {
  const net = sumNet([
    { cost: 100, refund: { kind: 'none' } },
    { cost: 500, refund: { kind: 'refunded', amount: 500, at: 1 } },
    { cost: 750, refund: { kind: 'pending' } },
  ]);
  expect(net).toBe(100 + 0 + 750);
});
