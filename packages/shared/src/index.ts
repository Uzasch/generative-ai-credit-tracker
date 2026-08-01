/**
 * Shared domain types for Token Tracker for AI Generation.
 *
 * This is the single source of truth for the generation-event shape.
 * Imported by the extension, the dashboard, and the Convex backend.
 * See AGENTS.md §6. Do not re-declare these shapes elsewhere.
 */

/** The AI-generation tools we track. Add a tool here + an adapter, nothing else. */
export const TOOLS = ['flow', 'higgsfield', 'kling'] as const;
export type Tool = (typeof TOOLS)[number];

/** A charge can later be reversed. Refunds net out — they never delete history. */
export type RefundState =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'refunded'; amount: number; at: number };

/**
 * The core recorded unit: one generate action that consumes tokens/credits.
 * Roll-ups: event -> asset -> brand, and independently event -> user.
 */
export type GenerationEvent = {
  /** The editor who triggered the generation. */
  userId: string;
  tool: Tool;
  /** IP / brand — the top-level roll-up entity. */
  brandId: string;
  /** Song / video / image. Shared across users: same asset aggregates usage. */
  assetId: string;
  /** Tokens or credits consumed by this event. */
  cost: number;
  refund: RefundState;
  /** Client capture time, ms since epoch. */
  capturedAt: number;
  /** Tool-side job/request id, used to reconcile refunds. */
  toolRef?: string;
};

/** Type guard for untrusted values coming off the wire / captured traffic. */
export function isTool(value: unknown): value is Tool {
  return typeof value === 'string' && (TOOLS as readonly string[]).includes(value);
}
