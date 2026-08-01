# Capture-probe-first (phased discovery)

Before building the structured Generation-event pipeline, we ship a thin
**capture probe**: an extension that monkeypatches `fetch` in the MAIN world and
logs all raw `fnf-api-gw.higgsfield.ai` request/response traffic to Convex. We do
this because the signals that matter most — how a refund appears, and whether
`cost` scales with output count — have never been captured, and designing refund
handling blind would be guesswork. The probe lets us find those signals in real
traffic first; the structured model follows once we know what the traffic
actually contains.

## Consequences

- Phase 1 is deliberately throwaway-ish: its value is discovery, not the final
  data model. That is accepted, not a mistake to avoid.
- Raw captures are retained (not just parsed) — this is also what makes
  auto-shipped detection rules replayable (see ADR-0003).
