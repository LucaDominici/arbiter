---
title: 'Can I trust a governance tool that does not govern itself?'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Can I trust a governance tool that does not govern itself?

> A tool that tells me to enforce invariants had better enforce them on its own codebase — and I want to see the evidence, not take it on faith.

## The problem

Governance tooling asks you to accept constraints. That's only credible if the tool lives by the same
rules and the evidence is inspectable, not marketing.

> **Note on scope:** unlike the other pages here, this one is about trusting _arbiter itself_. The
> mechanisms below are arbiter's **own dogfooding** (Level A — how arbiter governs arbiter), not
> enforcement you inherit in your project. They are evidence, not a feature you install.

## Who feels it

- Evaluators deciding whether to adopt arbiter.
- Reviewers who want to read the enforcement, not a claim about it.

## How arbiter governs itself

arbiter governs arbiter at **L2**, with `selfOnly` self-checks that exist precisely to keep the tool
honest:

- **INV-45 (self-dogfood):** the generated templates must match arbiter's own materialized `.claude/`
  config — the tool can't ship config it doesn't run.
- **INV-51 (catalog ↔ AGENTS parity):** every invariant in `src/invariants/catalog.ts` must appear in
  `AGENTS.md` with the same title, and vice versa.
- **INV-52 (enforcement-wired):** a claimed enforcement is only valid if the cited `check-*.mjs` is
  actually invoked in `scripts/check-all.mjs` — no paper invariants.
- **INV-59 (local ↔ CI parity):** the local gate and CI run the same checks (hash-verified).

The evidence trail is public: `src/invariants/catalog.ts`, `.claude/hooks/`, `scripts/check-all.mjs`,
and the GitHub Actions runs executing the same lanes.

Source: the self-governance case study (`arbiter governs itself`); invariant catalog (INV-45, INV-51,
INV-52, INV-59); [Positioning](/governance/).

## How to verify

Browse the repository directly — every claim above is a file you can read:

```bash
# In the arbiter repo:
sed -n '1,40p' src/invariants/catalog.ts
ls .claude/hooks/
node scripts/check-all.mjs L2     # the same gate arbiter holds itself to
```

For **machine-readable evidence in your own project**, the evidence harness (INV-27, INV-33) emits
`.evidence/SUMMARY.json` — but note this is **L4-only** and opt-in:

```bash
arbiter verify evidence           # in a generated L4 project
```

**Why arbiter itself runs without the evidence harness:** arbiter governs itself at L2, and the
harness defaults to L4 (ADR-037) — consistent, not an oversight. Contract testing is enabled on
self (`features.contractTesting: true`); it is a structural no-op here (no owned/consumed API,
ADR-028), verified via `arbiter diff` before flipping the flag. Activating the evidence harness
for real is deferred and tracked (#1872): arbiter's `.claude/settings.json` carries
hand-adapted, self-only hooks (`.dogfood-divergences.json`) that a mechanical `arbiter update`
would silently collapse into the generic template shape — enabling it safely needs the same
hand-adaptation those hooks already got, not a blind regenerate. See ADR-037's 2026-07-10
amendment for the full trail.

## What it does NOT do

- It is **not a compliance certification** — the evidence artifacts are not ISO 27001 / SOC 2 / GDPR
  certification, however inspectable they are.
- It makes **no ROI claims** — dogfooding demonstrates consistency, not metrics. arbiter collects no
  telemetry, so it publishes no adoption or defect-rate numbers.

## Related

- [Standards documented but not enforced](/problems/enforced-not-advisory)
- [Agents drift from our conventions](/problems/agents-drift)
- [Governance & Legal](/governance/)
