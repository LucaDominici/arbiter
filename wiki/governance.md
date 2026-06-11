---
generated: true
source: 'docs/GOVERNANCE.md'
source_sha: '14a9710ab5c98e5e4fdc6b219ae469f4af3f4952'
last_updated: '2026-06-11'
---

# Governance — arbiter

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/GOVERNANCE.md](../docs/GOVERNANCE.md)

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

(Mirrors the frontmatter `status:` field; the tag exists so the

_[content truncated — see source for full text]_
