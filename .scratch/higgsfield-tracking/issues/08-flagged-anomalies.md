# 08 — Flagged anomalies: click tripwire, cost mismatch, unknown status

**What to build:** When the runtime can't confidently classify something, it
records a Flagged anomaly with the raw evidence instead of guessing (ADR-0002).
This is the input the offline Discovery agent will later consume; the agent
itself is out of scope here.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] A `flagged_anomalies` Convex table stores the anomaly kind + raw evidence,
      scoped by `organizationId`.
- [ ] Minimal DOM capture observes Generate-button clicks and the button's
      displayed cost (kept as small as possible; observe-only).
- [ ] Three triggers raise anomalies: (a) a Generate click with no matching
      generate request within a window; (b) button cost ≠ response cost (the
      event is still recorded with the response cost, and flagged); (c) an
      unknown/unseen Job status.
- [ ] `attribute()` (from ticket 05) emits the cost-mismatch and unknown-status
      anomalies; the click tripwire emits the no-request anomaly.
- [ ] Demo: cancel a generation after clicking Generate → a click-with-no-request
      anomaly is recorded.
