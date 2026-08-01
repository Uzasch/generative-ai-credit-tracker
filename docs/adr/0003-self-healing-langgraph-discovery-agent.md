# Self-healing LangGraph discovery agent, auto-shipping detection rules

Detection logic grows via an **offline LangGraph agent** (Python) that consumes
flagged anomalies plus the retained raw logs, locates the responsible
request/pattern, and produces new detection rules for the Higgsfield adapter.
The agent emits **code, never live per-event verdicts**, so it stays entirely
out of the billing hot path — which is why introducing Python does not violate
the locked TS runtime stack (AGENTS.md §1): it is dev-tooling, not runtime.
Agent-produced rules **auto-ship**, with humans auditing after the fact.

## Why this is safe despite auto-shipping billing logic

Auto-ship is only acceptable under three invariants, all forced by AGENTS.md's
"auditable history / pure tested logic" standards:

1. **Raw captures are retained** and every detection rule is a **pure, replayable
   function** over them — so a wrong rule is never destructive; affected events
   are recomputed once it's fixed.
2. **Every rule is versioned and stamped onto the events it produced**
   (`ruleVersion`), so a bad rule's blast radius is queryable.
3. **The agent must ship a passing fixture test** built from the flagged
   anomaly, or the deploy does not proceed.

The result: auto-ship can cost *temporary* wrongness on the dashboard, never
*permanent* wrongness.

## Considered and rejected

- **Propose → human-approves-before-merge.** Safer, but the team chose auto-ship
  for faster coverage of new cases, accepting the audit-after tradeoff given the
  replayability invariants above.
- **Runtime LLM classifier** (agent in the billing path). Rejected — see
  ADR-0002.
