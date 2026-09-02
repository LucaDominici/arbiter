// Test guard for #1244 — Docs-Evo 5/5: migrate WIKI docs + retire bespoke knowledge-map.
//
// Source of truth for the deletion scope is DISPOSITION-REGISTER §WIKI (a local design
// artifact, never committed to git). To make the scope reviewable and enforceable, the
// resolved 64-file DELETE list and the FLAG (must-survive) guard list are embedded here.
//
// Asserts (TDD red → green):
//   1. bespoke knowledge-map machinery retired (doc + 2 scripts + 2 orphan tests gone)
//   2. 'knowledge map' check unregistered from check-all.mjs + check-local-ci-parity.mjs + harness.mjs
//   3. INV-56 retired as a tombstone (status:'retired') per ID-STABILITY — its protected
//      doc + enforcer are gone, but the ID is preserved (never deleted/reused)
//   4. every §WIKI DELETE-list hand doc is gone
//   5. wiki-before-delete: each deleted doc has a wiki/ counterpart (no content loss)
//   6. over-delete guard: FLAG-set + KEEP-GENERATED contracts still exist
//   7. INV-108 core-set surface ≤ 20 (DoD)
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { selectSsotDocs } from '../../scripts/gen-ssot-core.mjs'

const ROOT = resolve(__dirname, '..', '..')
const r = (p: string) => join(ROOT, p)

// ── DELETE list: register §WIKI hand docs (64), confirmed wiki-covered ───────────
const DELETE_LIST = [
  'docs/case-studies/arbiter-itself-canary.md',
  'docs/case-studies/arbiter-itself-evidence.md',
  'docs/case-studies/arbiter-itself.md',
  'docs/case-studies/incidents/01-inv04-any-ban-unsafe-cast.md',
  'docs/case-studies/incidents/02-inv06-orphan-todo-milestone-closeout.md',
  'docs/case-studies/incidents/03-inv12-no-pii-generator.md',
  'docs/case-studies/incidents/04-inv32-matrix-fixture-parity.md',
  'docs/case-studies/incidents/05-canon16-refactor-first-saving-file.md',
  'docs/CHANNELS.md',
  'docs/FAQ.md',
  'docs/POSITIONING.md',
  'docs/DEVELOPMENT/TESTING-STRATEGY.md',
  'docs/GOVERNANCE/coc-enforcement-runbook.md',
  'docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md',
  'docs/GOVERNANCE/LABELS.md',
  'docs/i18n/CONTRIBUTING.md',
  'docs/internal/mutation-testing.md',
  'docs/METHOD/CONTEXT_PACK_SPEC.md',
  'docs/METHOD/CONTEXT_SLICE_SPEC.md',
  'docs/METHOD/EXTRACTION_PLAYBOOK.md',
  'docs/METHOD/KNOWLEDGE_MAP.md',
  'docs/METHOD/REUSE_REGISTRY_SPEC.md',
  'docs/MIGRATION/config-versioning.md',
  'docs/MIGRATION/decomposition-backends.md',
  'docs/MIGRATION/deploy-config-consolidation.md',
  'docs/MIGRATION/no-github-default.md',
  'docs/PRODUCT/COMPETITION.md',
  'docs/PRODUCT/CROSS-LANGUAGE-MATRIX.md',
  'docs/PRODUCT/ENFORCEMENT-PHILOSOPHY.md',
  'docs/PRODUCT/EXTENDED-INVARIANTS.md',
  'docs/PRODUCT/FEATURE_COMPARISON.md',
  'docs/PRODUCT/MEASUREMENT-GUIDE.md',
  'docs/PRODUCT/PRESETS.md',
  'docs/PRODUCT/TEST-PYRAMID-PROFILES.md',
  'docs/PRODUCT/WHAT-ARBITER-IS-NOT.md',
  'docs/REFERENCE/ai-pr-gate.md',
  'docs/REFERENCE/BLAME.md',
  'docs/REFERENCE/java-adapter.md',
  'docs/REFERENCE/nightly-weekly-heartbeat.md',
  'docs/REFERENCE/pact-provider-states.md',
  'docs/REFERENCE/pharma-overlay.md',
  'docs/REFERENCE/postman-newman-contract.md',
  'docs/REFERENCE/recipes/B10-debug-mode.md',
  'docs/REFERENCE/recipes/brownfield-existing-ci.md',
  'docs/REFERENCE/recipes/compose-with-frontend-design.md',
  'docs/REFERENCE/recipes/cost-optimized-phase-handoff.md',
  'docs/REFERENCE/recipes/custom-ai-tool-target.md',
  'docs/REFERENCE/recipes/custom-invariant-advanced.md',
  'docs/REFERENCE/recipes/customize-wizard.md',
  'docs/REFERENCE/recipes/migrate-from-bmad.md',
  'docs/REFERENCE/recipes/migrate-from-spec-kit.md',
  'docs/REFERENCE/recipes/monorepo-adoption.md',
  'docs/REFERENCE/recipes/perf-debugging.md',
  'docs/REFERENCE/recipes/README.md',
  'docs/REFERENCE/recipes/recover-from-update-failure.md',
  'docs/REFERENCE/recipes/sibling-worktree.md',
  'docs/REFERENCE/recipes/tdd-enforcement.md',
  'docs/rfc/0000-template.md',
  'docs/rfc/0001-plugin-api-v2.md',
  'docs/runbooks/deployment.md',
  'docs/runbooks/prod-checklist.md',
  'docs/runbooks/rollback.md',
  'docs/runbooks/troubleshooting.md',
  'docs/SECURITY/RISK_ASSESSMENT.md',
  // docs/SYSTEM/CI-TIER-MODEL.md was §WIKI-migrated by #1244, but #1502 (PORT D1)
  // re-established it as the canonical hand-authored spec for the cadence × governance
  // model (referenced by ADR-050 + ci-tier-workflows.md). It is now a live doc, not a
  // wiki-only mirror, so it is intentionally NOT in the delete list.
  'docs/SYSTEM/WORKFLOW-MODEL.md',
  'docs/testing/POST_MERGE_REVIEW_TEMPLATE.md',
] as const

// ── FLAG / KEEP guard: must NOT be deleted (over-delete protection) ──────────────
// Gate/test/src-locked, post-register additions, KEEP-GENERATED contracts, and the two
// FEATURE_MATRIX doc_refs (REQ-026/REQ-051) the INV-112 gate validates on disk.
const MUST_SURVIVE = [
  'docs/SECURITY/STRIDE.md', // INV-90 gate reads it
  'docs/SECURITY/ISO27001_ANNEX_A.md', // KEEP-GENERATED (register conflict → keep wins)
  'docs/internal/METHOD/PATTERNS_CATALOG.md', // structure test + canonical_id
  'docs/REFERENCE/api.md', // #807 env-var test asserts existence
  'docs/REFERENCE/gdpr-overlay.md', // #1251 — postdates register
  'docs/REFERENCE/iso27001-overlay.md', // #1252 — postdates register
  'docs/REFERENCE/iso9001-overlay.md', // #1253 — postdates register
  'docs/REFERENCE/compliance-menu.md', // #1254 — postdates register
  'docs/REFERENCE/coverage/dim-76-accessibility-a11y-audit-axe-lighthouse-pa11y.md', // INV-112 doc_ref (#1243)
  'docs/REFERENCE/RESILIENCE.md', // FEATURE_MATRIX REQ-051 doc_ref
  'docs/internal/DEVELOPMENT/REAL-PROJECT-TESTING.md', // FEATURE_MATRIX REQ-026 doc_ref
  'docs/internal/SYSTEM/CANON.md', // iron law (never touched)
] as const

// docs/X/Y.md → wiki/x-y.md (lowercase, '/'→'-', '_'→'-', drop docs/ prefix)
function wikiNameFor(docPath: string): string {
  return (
    docPath
      .replace(/^docs\//, '')
      .replace(/\//g, '-')
      .replace(/\.md$/, '')
      .toLowerCase()
      .replace(/_/g, '-') + '.md'
  )
}

describe('#1244 — bespoke knowledge-map retired', () => {
  it('docs/METHOD/KNOWLEDGE_MAP.md is deleted', () => {
    expect(existsSync(r('docs/METHOD/KNOWLEDGE_MAP.md'))).toBe(false)
  })
  it('knowledge-map scripts are deleted', () => {
    expect(existsSync(r('scripts/check-knowledge-map.mjs'))).toBe(false)
    expect(existsSync(r('scripts/knowledge-map-update.mjs'))).toBe(false)
  })
  it('orphaned knowledge-map test files are deleted (RT-01)', () => {
    expect(existsSync(r('__tests__/scripts/check-knowledge-map.test.ts'))).toBe(false)
    expect(existsSync(r('__tests__/scripts/knowledge-map-update.test.ts'))).toBe(false)
  })
  it("'knowledge map' check is unregistered from the gate + parity", () => {
    // scripts/harness.mjs was ALSO removed outright (A4, wave1 action plan —
    // redundant aggregator of gates already individually wired in check-all.mjs),
    // so there is no third file left to assert against here.
    expect(readFileSync(r('scripts/check-all.mjs'), 'utf-8')).not.toContain(
      'check-knowledge-map.mjs',
    )
    expect(readFileSync(r('scripts/check-local-ci-parity.mjs'), 'utf-8')).not.toContain(
      "'knowledge map'",
    )
  })
  it('INV-56 is retired as a tombstone (status:retired) per ID-STABILITY, not deleted', () => {
    const catalog = readFileSync(r('src/invariants/catalog.ts'), 'utf-8')
    // ID preserved (write-once: check-id-stability forbids deletion without a retire marker)
    expect(catalog).toContain("id: 'INV-56'")
    // …but retired, with no scripts/*.mjs enforcer cited (the gate it ran was deleted)
    const inv56Block = catalog.slice(catalog.indexOf("id: 'INV-56'"))
    const nextEntry = inv56Block.indexOf("id: 'INV-57'")
    const block = inv56Block.slice(0, nextEntry)
    expect(block).toContain("status: 'retired'")
    expect(block).not.toMatch(/scripts\/check-knowledge-map\.mjs/)
  })
})

describe('#1244 — §WIKI hand docs migrated (deleted, wiki reproduces)', () => {
  it.each(DELETE_LIST)('deleted: %s', (p) => {
    expect(existsSync(r(p)), `${p} should be deleted (migrated to wiki)`).toBe(false)
  })

  // The generated wiki is a 1:1 derived mirror (gen-wiki sources from `git ls-files docs/`;
  // INV-116 requires every wiki page's `source:` to be a tracked path). Wiki-before-delete
  // coverage was proven in the red-phase run_log (the counterpart existed when both did);
  // once the source doc is deleted its wiki page MUST be pruned, else INV-116 (citation +
  // stale) goes red. Content persists in git history, not the live wiki.
  it.each(DELETE_LIST)('migrated: %s wiki page pruned after source delete', (p) => {
    const wiki = `wiki/${wikiNameFor(p)}`
    expect(existsSync(r(wiki)), `${p} deleted → ${wiki} must be pruned (INV-116)`).toBe(false)
  })
})

describe('#1244 — over-delete guard (HARD RULE: only register §WIKI deleted)', () => {
  it.each(MUST_SURVIVE)('preserved: %s', (p) => {
    expect(existsSync(r(p)), `${p} is NOT a §WIKI item — must NOT be deleted`).toBe(true)
  })
})

describe('#1244 — DoD: INV-108 core-set surface stays bounded', () => {
  // #1244's original budget was 20 (the wiki-migration DoD, at the time). Convergence T3
  // (commit 69828e59, 2026-07-11) legitimately added 3 GOLD `kind/spine` docs —
  // docs/architecture/{arc42,c4-model,README}.md — that this doc's own SSOT set now lists
  // (`adr-index.md` stays excluded: its first kind/* tag is `adr`, per the selection rule).
  // T5 (gold-doc-tranches-t3-t5.md, self-charter enrollment) legitimately added
  // docs/methodology/agent-orchestration-and-context-hygiene.md (`kind/governance`, one of the
  // capability's own two normative-base charter docs — see gold-doc-capability.md §self-charter).
  // 2026-07-23 legitimately added docs/methodology/gate-throughput-patterns.md
  // (`kind/governance`, a sibling normative operating standard to the agent-orchestration doc
  // above — see gate-throughput-patterns.md's own header for the incident it codifies).
  // 2026-08-02 (#2182) legitimately added docs/internal/METHOD/ADJUDICATION.md
  // (`kind/method`, a backbone kind — the adjudication-with-audit protocol extracted from the
  // epic #2176 /ship v2 study; it sits alongside PROCESS/TESTING as a normative METHOD doc).
  // 2026-08-03 legitimately added docs/methodology/backlog-drain-playbook.md
  // (`kind/method`, a backbone kind — the wave-drain playbook distilled from the 41-issue
  // drain run; a normative operating standard alongside the two methodology docs above).
  // 2026-08-08 (#2241) legitimately added docs/architecture/feasibility.md — `kind/reference`
  // (not a backbone kind) but carrying `canonical_id: 'FEASIBILITY'`, which
  // SSOT_CORE_SET.md's own documented selection rule opts a doc into the core set
  // regardless of kind (docs/internal/METHOD/SSOT_CORE_SET.md: "a doc qualifies when
  // status: active and either its first kind/* tag is a backbone kind ... or it carries
  // a non-empty canonical_id").
  // 2026-08-09 (#2249) legitimately added docs/architecture/analysis.md — same rule:
  // `kind/reference` (not a backbone kind) but carrying `canonical_id: 'ANALYSIS'`.
  // 2026-08-09 (#2251) legitimately added docs/architecture/realization.md — matches
  // c4-model.md's frontmatter shape per #2251's own AC-1: `kind/spine` (a backbone kind)
  // AND `canonical_id: 'REALIZATION'`, either alone would qualify it into the core set.
  // 2026-08-29 (#2408) legitimately added docs/internal/METHOD/EVIDENCE_RETENTION.md — the
  // doc was ALREADY a METHOD backbone doc; it simply had no frontmatter, because
  // check-doc-style skipped docs/internal/** entirely and nothing ever asked for one. Giving
  // it the `kind/method` + `status: active` block its seven METHOD siblings carry is what
  // made the selector finally see it. Tagging it otherwise to stay under the ceiling would be
  // gaming the counter, not bounding the surface.
  // 2026-08-29 (#2429) legitimately added docs/internal/METHOD/TABLETOP-SCENARIOS.md — the
  // seeded scenario catalogue for /tabletop, carrying the same `kind/method` +
  // `canonical_id` frontmatter its eight METHOD siblings carry. Either alone qualifies it;
  // demoting it to a non-backbone kind to duck the ceiling would be gaming the counter.
  // This is a stale counter, not a regression: ground truth (§7 of the playbook) wins over
  // the pre-growth ceiling. Bound updated to the current real count so the budget still
  // catches future unbounded growth.
  // 2026-09-02 (ontology wave 1) legitimately added two: docs/internal/SYSTEM/ID-REGISTRY.md,
  // the registry of every identifier scheme — the file an agent reads to learn what INV/ADR/REQ/
  // MS/SRC even mean — and docs/internal/SYSTEM/OD-REGISTRY.md, which the id-registry gate
  // resolves every OD-NN citation against. Both carry the `canonical_id` their SYSTEM siblings
  // (CANON.md, HOOK-CONTRACTS.md) carry, and either alone qualifies them. Clearing OD-REGISTRY's
  // canonical_id to stay under the ceiling was tried and reverted: it is precisely the demotion
  // the note above forbids, and the honest remedy is the one that note itself names — ground
  // truth wins over the pre-growth ceiling, and the bound moves to the new real count so it
  // keeps catching unbounded growth.
  it('selectSsotDocs returns at most 34 canonical core docs', () => {
    const core = selectSsotDocs(ROOT)
    expect(
      core.length,
      `core set = ${core.length}: ${core.map((c) => c.relPath).join(', ')}`,
    ).toBeLessThanOrEqual(34)
  })
})
