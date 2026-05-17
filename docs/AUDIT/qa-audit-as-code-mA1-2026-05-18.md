# Audit-as-Code (M-A1) — Port Notes

**Date:** 2026-05-18
**Origin:** #727 — "M-A1 — Audit-as-Code (machine-checkable QA-audit phases)"

## What landed in this PR

`src/templates/governance/qa-audit-phases.md.ejs` — the **policy + format template** for QA-audit phases.

The template ports the FORMAT of the reference-impl `qa-audit/PHASE*.md` reports (15 narrative reports, 4951 LOC, dated 2026-02-12), NOT the content. The reference reports are CERIMONIA — one-shot, no rerun. M-A1 makes each phase a JSON-schema + rerun command; the MD report is the OUTPUT of a rerun, not the audit itself.

## What did NOT land

- **`src/generators/qa-audit.ts`** — the generator that emits per-stack phase scripts + CI cron workflows. Tracked as a follow-up.
- **`arbiter audit run [--phase NN] [--all] [--json]`** CLI command. Documented in the template; implementation tracked as a follow-up.

Both follow-ups require:

- CANON-05 (generator unit test)
- CANON-06 (command test)
- CANON-11 (write-files contract for the generator)
- INV-32 (matrix fixture per proven cell)

Shipping the policy template first surfaces the format + opt-in flag so downstream projects can author their own phase schemas while the wiring lands incrementally.

## The format

Each phase is a JSON document at `.arbiter/qa-audit/phase-<NN>.json`:

```jsonc
{
  "phase": "01",
  "title": "Static analysis baseline",
  "rerun": "node scripts/qa-audit/phase-01.mjs",
  "cadence": "weekly",
  "output_path": "docs/QA_AUDIT/phase-01-latest.md",
  "checks": [{ "id": "lint-clean", "command": "npm run lint", "expect_exit_code": 0 }],
  "severity_thresholds": { "errors_max": 0, "warnings_max": 10 },
}
```

The output MD is the **artifact of the most recent rerun**, committed so historical reports are findable. The schema is the source of truth — when audit logic changes, edit the schema, not the MD.

## Default phases (scaffolds)

| Phase | Title                           | Cadence   |
| ----- | ------------------------------- | --------- |
| 01    | Static analysis baseline        | weekly    |
| 02    | Test coverage + quality         | weekly    |
| 03    | Architecture conformance        | bi-weekly |
| 04    | Security baseline               | weekly    |
| 05    | Performance + resource baseline | monthly   |
| 06    | Documentation freshness         | monthly   |

Project-specific phases live in the project's `.arbiter/qa-audit/phase-NN.json` files.

## Cadence enforcement

A separate CI cron job reruns each phase at its declared cadence. If the latest output MD is older than the cadence window, the cadence job fails. Catches the "audits defined but never rerun" failure mode.

Suggested cron mappings provided in template.

## Anti-patterns documented (NI-4 ceremony defense)

- Phase whose rerun is "ask team X" → ceremony, not audit
- Phase that always passes → wrong thresholds or decorative
- Phase whose output is never read → audit theatre
- Ad-hoc phases not in schema → no cadence enforcement

## Sequencing with #715

This PR was sequenced **after #715 (Verification Bridge audit)** per the META plan, because both touch the "audit surface". The #715 audit confirmed arbiter already has the verification bridge core (ADR-039); M-A1 is the complementary QA-audit phase format. The two are orthogonal — `verify plan` validates a single PLAN.json; `audit run` reruns recurring quality phases.

## CANON references

- **CANON-04** (every .ejs has a render test): satisfied — `__tests__/templates/governance-render.test.ts` adds 8 assertions: no EJS leaks, projectName, all 6 phases 01-06, schema fields, CLI signature, cron cadence mapping, anti-patterns + NI-4, opt-in flag name.

## Opt-in flag

```jsonc
{
  "governance": {
    "qa_audit_phases": true,
  },
}
```

## Source

#727 (M-A1). Reference-impl source: `qa-audit/PHASE*.md` (15 reports).
