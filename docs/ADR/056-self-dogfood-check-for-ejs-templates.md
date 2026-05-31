---
title: 'ADR-056: Self-dogfood check for EJS templates (#239)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '056'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-056: Self-dogfood check for EJS templates (#239)

**Date:** 2026-05-11
**Status:** Accepted
**Reference:** Issue #239, INV-45

**Context:** arbiter generates `.claude/` configuration files from EJS templates under `src/templates/claude/`. Over time, the materialized `.claude/` files in the arbiter repository diverged from their template sources (extended with arbiter-specific hooks, batch workflow commands, CI runner notes). There was no automated check to detect this drift, risking template degradation where future improvements to the materialized files would not be back-ported to the templates shipped to target projects.

**Decision:** Add `scripts/check-self-dogfood.mjs` — a Node.js script that renders every EJS template under `src/templates/claude/` with arbiter's own config (read from `arbiter.json`), normalizes both rendered and materialized content via Prettier, and diffs them line by line. Files with intentional divergences are registered in `.dogfood-divergences.json` with documented reasons. Config-gated templates (e.g. `guard-done-evidence.mjs` when `evidenceHarness=false`) are skipped. Wire the check into `scripts/check-all.mjs` L2 block. Codify as INV-45 (governance tier, alwaysActive) in the invariant catalog and AGENTS.md.

**Consequences:** Future template modifications will be caught at L2 gate if the corresponding materialized file diverges without a documented reason in `.dogfood-divergences.json`. Intentional arbiter-internal extensions remain explicitly documented. The check prevents silent template drift in both directions.
