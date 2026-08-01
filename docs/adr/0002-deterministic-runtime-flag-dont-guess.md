# Deterministic runtime — flag anomalies, never guess

The runtime that decides what gets billed to an Asset is **deterministic
TypeScript/Convex with no LLM in the path**. When it encounters something it
cannot classify — a Generate click with no matching request, a cancelled
request, an unknown Job status, or a Cost that disagrees with the button — it
records a **flagged anomaly** with the raw evidence instead of guessing an
outcome. We chose this over a live LLM/agent classifier because billing numbers
must be reproducible and auditable; a probabilistic verdict in the hot path
would make totals unexplainable.

## Consequences

- Every ambiguous case is preserved as evidence, which becomes the input to the
  offline Discovery agent (see ADR-0003).
- The extension observes only — it never blocks or alters the tool's requests
  (AGENTS.md §5), so "flag" is the strongest action the runtime takes.
