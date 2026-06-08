---
title: 'Governance — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-06-08'
owner: ''
canonical_id: 'GOVERNANCE'
tags: ['audience/dev', 'kind/governance']
related: []
---

# Governance — arbiter

Consolidated governance reference: the governance overview, the RACI responsibility register, the ID-stability protocol, the tag taxonomy, and the good-first-issue policy. Sections below were previously separate files.

---

## arbiter Governance

arbiter is governed by the same framework it ships. This page surfaces the key
governance artifacts so contributors and adopters can see exactly how the rules
are applied and enforced.

---

## Canonical governance documents

| Document                                  | Purpose                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| [`AGENTS.md`](../AGENTS.md)               | Machine-readable invariant catalog — consumed by Claude Code hooks and the L1/L2 gate |
| [`docs/SYSTEM/CANON.md`](SYSTEM/CANON.md) | 15 process-level rules derived from audit waves #151–#186                             |
| [`docs/GOVERNANCE/RACI.md`](#raci)        | Responsibility matrix for governance decisions                                        |

## Architecture Decision Records

| ADR                                   | Title           | Status   |
| ------------------------------------- | --------------- | -------- |
| [ADR-041](ADR/041-task-workflow.md)   | Task workflow   | Accepted |
| [ADR-042](ADR/042-gate-tiers.md)      | Gate tiers      | Accepted |
| [ADR-043](ADR/043-docs-site-ia.md)    | Docs site IA    | Accepted |
| [ADR-044](ADR/044-docs-versioning.md) | Docs versioning | Accepted |

## Self-governance case studies

Self-governance narratives (arbiter-governs-arbiter, evidence trail, nightly canary,
incident case studies) are compiled into the generated wiki (Obsidian viewer).

## How decisions are made

Governance changes follow the same path as code changes:

1. Issue opened with `governance` label
2. Red-team review before plan is approved
3. CANON-NN compliance checked at plan phase
4. Gate must be GREEN before merge (no `--no-verify` exceptions)

See [`docs/SYSTEM/CANON.md`](SYSTEM/CANON.md) for the full decision protocol.

---

## RACI Matrix — arbiter

<!-- arbiter-managed: claim-verified-governance (INV-90) -->
<!-- HIGH and CRITICAL responsibilities require a @RACI:<id>-tagged test. -->
<!-- Run: node scripts/check-stride-traceability.mjs to verify. -->

## Responsibility Matrix

| ID  | Responsibility | Accountable | Responsible | Consulted | Informed | Priority |
| --- | -------------- | ----------- | ----------- | --------- | -------- | -------- |

<!-- R001 retired 2026-05-18: release.yml deleted in #862 CI tabula-rasa.
     Restore when a release workflow is rebuilt from a clean design. -->

<!--
## How to use this table

1. Add a row for each key responsibility or decision area.
2. Set Priority: CRITICAL, HIGH, MEDIUM, or LOW.
3. For HIGH and CRITICAL responsibilities, annotate the verifying test with:
       // @RACI:<id>
   where <id> matches the ID column (e.g., // @RACI:R001).
4. Run: node scripts/check-stride-traceability.mjs
-->

---

## Invariant ID Stability Policy

**Issue:** #610  
**Enforced by:** `scripts/check-id-stability.mjs` (L2 gate)

---

## Write-Once Rule

Invariant IDs (e.g., `INV-01`, `INV-42`) are write-once public identifiers. Once an ID appears in `INVARIANT_CATALOG`, it may never be deleted without a retire marker, and it may never be reused for a different invariant.

This matters because:

- Generated AGENTS.md files in target projects reference IDs by name.
- Downstream CI hooks and suppression files cite IDs.
- Removing or reassigning an ID silently breaks any target that pinned it.

## Retirement Protocol

When an invariant is superseded or no longer applicable:

1. **Do not delete the entry from `catalog.ts`.**
2. Add `status: 'retired'` to the entry.
3. Add `retiredReason` explaining why (e.g., "Superseded by INV-62 which covers the same concern with stronger enforcement").
4. Optionally add `redirectTo` pointing to the replacement ID.
5. The entry remains in the catalog forever, clearly marked.

```ts
{
  id: 'INV-XX',
  // ... other fields
  status: 'retired',
  retiredReason: 'Superseded by INV-YY (stronger enforcement added in W3).',
  redirectTo: 'INV-YY',
}
```

Retired entries are excluded from generated output (AGENTS.md, filter results) but remain in the catalog as a permanent record.

## CI Enforcement

`scripts/check-id-stability.mjs` runs as an L2 gate. It:

1. Diffs `src/invariants/catalog.ts` against `origin/main`.
2. If `catalog.ts` changed, loads both versions via `tsx`.
3. Compares IDs: any ID present in `origin/main` that is absent in HEAD without `status: 'retired'` fails the gate.

This prevents accidental removal of IDs during refactors.

## Redirect Handling

The `redirectTo` field stores redirect data in the catalog. Future CLI support (`arbiter explain <old-ID>`) will surface this to users and is tracked in issue #545.

---

## arbiter Tag Taxonomy

Closed vocabulary for the `tags:` frontmatter field. Adding a tag that is not
listed here is a CANON-16-style violation: extend this taxonomy first, then
use the tag.

Tags are populated by the P5 backfill pass of the docs frontmatter codemod.
Until then, every `tags:` field reads `[]`.

## Taxonomy

### Document kind

| Tag               | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `kind/adr`        | Architecture Decision Record under `docs/ADR/`                 |
| `kind/runbook`    | Operational runbook (incident response, maintenance procedure) |
| `kind/spine`      | Directory index / spine README pointing at sibling docs        |
| `kind/ssot`       | Canonical source of truth governed by SSOT_CORE_SET            |
| `kind/canon`      | Process rule (CANON-NN entry)                                  |
| `kind/invariant`  | Invariant definition (INV-NN tier reference)                   |
| `kind/reference`  | Reference card; concise lookup material                        |
| `kind/method`     | Process / methodology document under `docs/METHOD/`            |
| `kind/audit`      | Snapshot or audit report under `docs/audits/`                  |
| `kind/migration`  | Migration guide under `docs/MIGRATION/`                        |
| `kind/setup`      | Install / setup / quickstart                                   |
| `kind/governance` | Governance / RACI / contributor policy                         |
| `kind/security`   | Security / compliance / threat model                           |
| `kind/api`        | Public API surface doc                                         |
| `kind/internal`   | Internal-only doc; not part of the public surface              |
| `kind/archive`    | Archived doc retained for historical context                   |

### Audience

| Tag                | For whom                                                       |
| ------------------ | -------------------------------------------------------------- |
| `audience/dev`     | Developers contributing to arbiter or building on it           |
| `audience/ops`     | Operators / SRE running arbiter or arbiter-scaffolded projects |
| `audience/agent`   | Read by Claude Code / agents during a task                     |
| `audience/auditor` | Compliance / regulatory reviewer                               |

### Lifecycle

| Tag                    | Meaning                                        |
| ---------------------- | ---------------------------------------------- |
| `lifecycle/draft`      | Work in progress; do not depend on contents    |
| `lifecycle/active`     | Current; safe to reference                     |
| `lifecycle/deprecated` | Superseded; pending removal                    |
| `lifecycle/archived`   | Kept for history only; no longer authoritative |

(Mirrors the frontmatter `status:` field; the tag exists so the taxonomy is searchable in tools like Obsidian.)

### Scope

| Tag                | Scope                                                        |
| ------------------ | ------------------------------------------------------------ |
| `scope/self`       | Concerns arbiter as a project (self-config)                  |
| `scope/framework`  | Concerns the framework arbiter scaffolds for target projects |
| `scope/dual-track` | Cross-cuts both; dual-track contract applies (CANON-16)      |

## Conventions

- Tags are kebab-case, prefixed by category (e.g. `kind/adr`, never `adr`).
- Multiple categories may apply (e.g. `[kind/adr, audience/dev, scope/dual-track]`).
- Tags are NOT GitHub issue labels; the two spaces share no namespace.
- Removing a tag from this taxonomy requires sweeping every doc that uses it.

## Adding a new tag

1. Confirm no existing tag covers the concept.
2. Open a docs PR adding the row to this file (CANON-16 dual-track does not apply — taxonomy is self-only).
3. Backfill any docs that should adopt the new tag in the same PR.

---

## Good First Issue Policy

Issues labeled `good first issue` are curated on-ramps for first-time contributors. This policy defines what qualifies and how maintainers manage the label.

## Criteria

An issue qualifies as a good first issue when **all** of the following are true:

| Criterion        | Rule                                                            |
| ---------------- | --------------------------------------------------------------- |
| **Size**         | ≤ `size/S` (≤ 4h estimated)                                     |
| **Scope**        | Touches ≤ 2 files; no architectural decisions required          |
| **Clarity**      | Has explicit acceptance criteria + file paths in the issue body |
| **Independence** | No blocking dependencies on other open issues                   |
| **Mentor**       | A maintainer is assigned and available for 1–2 review cycles    |

Issues that require understanding the full plugin API, schema migrations, or CI infrastructure do **not** qualify — even if they seem small.

## Labeling

- Maintainers apply `good first issue` + `size/S` (or `size/XS`) simultaneously.
- Remove `good first issue` if a dependency appears or scope grows after filing.
- The canonical filter for contributors: `is:issue is:open label:"good first issue"`.

## Issue body template

Use `docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md` when filing curated issues. Fill in all sections before applying the label.

## Backlog of curated launch issues

See `docs/GOVERNANCE/GOOD-FIRST-ISSUE-CURATION.md` for the 10 issues curated at launch.

## Manual welcome

First-time contributors are welcomed manually by a maintainer on PR open. The maintainer points to CONTRIBUTING.md and sets response-time expectations.
