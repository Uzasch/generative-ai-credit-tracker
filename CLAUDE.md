# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Engineering standards — read `AGENTS.md`

**All coding standards, the locked tech stack, repo layout, data model, and
build/lint/test commands live in `AGENTS.md`** — the canonical, cross-agent
standards file (also read by Codex, Cursor, etc.). Follow it. Do not duplicate
or fork those standards into this file; update `AGENTS.md` instead. `README.md`
describes what the product is.

## Repository status

This repository is being scaffolded — the standards and stack are decided (see
`AGENTS.md`) but application code is still minimal. The project is a "token
tracker for AI generation": a browser extension + web dashboard + Convex backend
that tracks AI-generation credit usage per user and per asset, rolled up to a
brand, with refunds reconciled. As real code lands, keep `AGENTS.md`'s Commands
section accurate.

## Skills tooling

Engineering skills are vendored into `.agents/skills/` from the `mattpocock/skills` GitHub repo. `skills-lock.json` at the repo root pins each skill's source path and content hash — treat it as the lockfile: don't hand-edit the vendored `SKILL.md` files or the lock hashes; re-sync from source instead.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
