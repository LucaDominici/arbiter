// Affects registry for opt-in selective gating (#2094). Coarse buckets, not
// per-check precision: a check is skippable only if it's in one of the
// narrow buckets below (docs-only / workflows-only / templates-only) AND no
// changed file matches its `affects` globs. Every other check name defaults
// to ALWAYS (affects: ['**']) — refine a check out of ALWAYS only once
// evidence shows its bucket is provably safe, never speculatively.
//
// This file is data, not logic — computeSkipped() in check-all.mjs consumes
// it. Keep check names byte-identical to their runCheck/runWarnCheck/
// runToolCheck call sites in check-all.mjs; check-selective.test.ts asserts
// registry coverage against the live gate so a renamed check without a
// registry update fails the test, not silently falls through to ALWAYS
// (ALWAYS is safe-by-construction, but an untracked rename is still a bug).

const ALWAYS = ['**']
const DOCS = [
  'docs/**',
  'wiki/**',
  'standards/**',
  '*.md',
  'AGENTS.md',
  'README.md',
  'CLAUDE.md',
  'LICENSE',
  'NOTICE',
  'PRIVACY.md',
  '.claude/**/*.md',
]
const WORKFLOWS = ['.github/**']
const TEMPLATES = ['src/templates/**', 'src/kit/**']

// name -> affects globs. Names must match check-all.mjs's runCheck(name, ...) literals.
export const GATE_AFFECTS_REGISTRY = [
  // ─── docs-only ──────────────────────────────────────────────────────────
  { name: 'docs', affects: DOCS },
  { name: 'wiki lint (INV-116)', affects: DOCS },
  { name: 'ssot core', affects: DOCS },
  { name: 'doc links', affects: DOCS },
  { name: 'doc path citations (#2243)', affects: DOCS },
  { name: 'governance mirror sync (#1805)', affects: DOCS },
  { name: 'doc style', affects: DOCS },
  { name: 'claude-md lint (#1266)', affects: DOCS },
  { name: 'doc index (#1102)', affects: DOCS },
  { name: 'llms.txt drift (#1721)', affects: DOCS },
  { name: 'status dashboard', affects: DOCS },
  { name: 'derived pages (#1838)', affects: DOCS },
  { name: 'gap register', affects: DOCS },
  { name: 'ssot core index (#1100)', affects: DOCS },
  { name: 'adr index (INV-107)', affects: DOCS },
  { name: 'adr digest (INV-107)', affects: DOCS },
  { name: 'adr enforcement linkage (#1473)', affects: DOCS },
  { name: 'canonical paths', affects: DOCS },
  { name: 'canon references', affects: DOCS },
  { name: 'canon enforcement parity (B1)', affects: DOCS },
  { name: 'phase doc consistency (INV-113)', affects: DOCS },
  { name: 'doc-set presence', affects: DOCS },

  // ─── workflows-only ─────────────────────────────────────────────────────
  { name: 'ci tiers (INV-73)', affects: WORKFLOWS },
  { name: 'action pin parity', affects: WORKFLOWS },
  { name: 'action pin sha (INV-76)', affects: WORKFLOWS },
  { name: 'workflow hardening (INV-76/95)', affects: WORKFLOWS },
  { name: 'actionlint', affects: WORKFLOWS },
  { name: 'ci tool parity', affects: WORKFLOWS },
  { name: 'perm-test guards', affects: WORKFLOWS },
  { name: 'anti-drift: workflow runners', affects: WORKFLOWS },
  { name: 'anti-drift: docker action runner safety (#1756)', affects: WORKFLOWS },
  { name: 'anti-drift: workflow docs sync', affects: WORKFLOWS },
  { name: 'anti-drift: workflow integrity', affects: WORKFLOWS },
  { name: 'anti-drift: workflow parallelism (INV-120)', affects: WORKFLOWS },
  { name: 'anti-drift: pr size gate', affects: WORKFLOWS },
  { name: 'workflow cache strategy (§17.5 rec 3)', affects: WORKFLOWS },
  { name: 'build-cache strategy (C3)', affects: WORKFLOWS },
  { name: 'nightly freshness (INV-93)', affects: WORKFLOWS },
  { name: 'monthly freshness (INV-82)', affects: WORKFLOWS },
  { name: 'deploy cosign supply-chain (INV-95/97/98)', affects: WORKFLOWS },
  { name: 'collab mode wired (INV-100)', affects: WORKFLOWS },
  { name: 'merge method ff-only (INV-101)', affects: WORKFLOWS },
  { name: 'settings coverage (#1121)', affects: WORKFLOWS },

  // ─── config-catalog parity ──────────────────────────────────────────────
  // Both source files, not a broad glob: this gate reconciles exactly these two
  // catalogs, so anything else changing cannot make it flip.
  {
    name: 'methodology coverage (#2039)',
    affects: ['src/commands/configure.ts', 'src/commands/method.ts'],
  },

  // ─── templates-only ─────────────────────────────────────────────────────
  { name: 'matrix fixtures', affects: TEMPLATES },
  { name: 'matrix proven cells', affects: TEMPLATES },
  { name: 'skills-matrix-schema', affects: TEMPLATES },
  { name: 'template tests', affects: TEMPLATES },
  { name: 'generator tests', affects: TEMPLATES },
  { name: 'command tests', affects: TEMPLATES },
  { name: 'brownfield tests (CANON-11)', affects: TEMPLATES },
  { name: 'catalog parity', affects: TEMPLATES },
  { name: 'kit catalog parity', affects: TEMPLATES },
  { name: 'phantom command scan (INV-111 ext, #1838)', affects: TEMPLATES },
  { name: 'version parity (#1838)', affects: TEMPLATES },
  { name: 'cli ref parity (INV-111)', affects: TEMPLATES },

  // ─── everything else: ALWAYS (safe default, not yet evidenced narrower) ──
  // #2387: defaults to ALWAYS — its surface spans .claude/** prose, src/templates/**
  // twins and the skill/command/agent registry the references resolve against, so no
  // narrow bucket is provably safe for it.
  { name: 'orchestration integrity (#2387)', affects: ALWAYS },
  { name: 'build-kit', affects: ALWAYS },
  { name: 'no redacted tokens', affects: ALWAYS },
  { name: 'no work refs', affects: ALWAYS },
  { name: 'private paths ignored', affects: ALWAYS },
  { name: 'no tracked artifacts (INV-117)', affects: ALWAYS },
  // #2429: reads .arbiter/evidence/tabletop/, which is outside every narrow bucket
  // (not docs/, not .github/, not src/templates/) — ALWAYS is the honest default.
  { name: 'tabletop evidence (#2429)', affects: ALWAYS },
  // #2159: found unwired by check-unwired-guards.mjs itself — see check-all.mjs.
  { name: 'hook routing (#2129)', affects: ALWAYS },
  { name: 'safety adopt ratchet (#2291)', affects: ALWAYS },
  { name: 'typecheck', affects: ALWAYS },
  { name: 'format', affects: ALWAYS },
  { name: 'lint', affects: ALWAYS },
  { name: 'unit tests', affects: ALWAYS },
  { name: 'greenfield smoke', affects: ALWAYS },
  { name: 'circular deps', affects: ALWAYS },
  { name: 'placeholders', affects: ALWAYS },
  { name: 'i18n raw strings', affects: ALWAYS },
  { name: 'spdx headers', affects: ALWAYS },
  { name: 'orphan TODOs', affects: ALWAYS },
  { name: 'no direct-fs outside the façade', affects: ALWAYS },
  { name: 'PII scan', affects: ALWAYS },
  { name: 'inline suppressions', affects: ALWAYS },
  { name: 'suppressions expiry', affects: ALWAYS },
  { name: 'commitlint', affects: ALWAYS },
  { name: 'test naming', affects: ALWAYS },
  { name: 'hardness inventory', affects: ALWAYS },
  // #2326: same checker, arbiter's own .claude/hooks/ surface. ALWAYS like its
  // template sibling — a hook can stop blocking from a change anywhere in its import graph.
  { name: 'hardness inventory (self hooks)', affects: ALWAYS },
  { name: 'install command (B1)', affects: ALWAYS },
  { name: 'tool claims', affects: ALWAYS },
  { name: 'third-party licenses', affects: ALWAYS },
  { name: 'global-invariants parity', affects: ALWAYS },
  { name: 'enforcement wired', affects: ALWAYS },
  // ALWAYS, and not out of caution: the id-registry gate scans the WHOLE tree for OD-NN
  // citations, so any edited file can change its verdict. The ontology meta-gate reads the
  // registry, check-all.mjs, src/cli.ts, .claude/settings.json and the Track-B gate roster;
  // the contract gate reads schemas/ plus a sibling checkout. None is narrowable to a path set.
  { name: 'id registry (INV-140)', affects: ALWAYS },
  { name: 'ontology wired (INV-141)', affects: ALWAYS },
  // ALWAYS, like its two ontology siblings: the gate reads the arc42 skeletons, the doc-set
  // manifest, the tier profile and the architecture document itself, so no single changed-path
  // predicate covers it — a narrower rule would let a skeleton edit skip the gate that guards it.
  { name: 'arc42 slots (INV-144)', affects: ALWAYS },
  // ALWAYS: the gate reads MILESTONES.yml, its schema and the INV catalog (to resolve an
  // INV-NN evidence_ref), so no changed-path predicate covers it without letting an edit to one
  // of those skip the gate that guards it.
  { name: 'milestones (INV-146)', affects: ALWAYS },
  // ALWAYS, like its ontology siblings: the gate reads every doc's frontmatter and the whole
  // invariant catalog, so no narrow path bucket contains its inputs.
  { name: 'runbook coverage (INV-148)', affects: ALWAYS },
  // ALWAYS: reads the use-case SSOT, the feature matrix and the scenario catalogue together —
  // three documents in three trees, so no narrow path bucket holds its inputs.
  { name: 'use cases (INV-149)', affects: ALWAYS },
  // ALWAYS: the gate reads SOURCES.md, its schema and every committed excerpt — no changed-path
  // predicate covers that set without letting an edit to one of them skip the gate that guards it.
  { name: 'sources tier 1 (INV-147)', affects: ALWAYS },
  { name: 'forma schema contract (INV-143)', affects: ALWAYS },
  { name: 'orchestrator coverage (#1410)', affects: ALWAYS },
  { name: 'constraint scan (INV-115)', affects: ALWAYS },
  { name: 'agent-dispatch matrix (#1267)', affects: ALWAYS },
  { name: 'node version ssot', affects: ALWAYS },
  { name: 'bloat ratchet', affects: ALWAYS },
  { name: 'exit code contract', affects: ALWAYS },
  { name: 'pipe/tee hazard', affects: ALWAYS },
  { name: 'plugin api stability', affects: ALWAYS },
  { name: 'deprecations', affects: ALWAYS },
  { name: 'hook contracts', affects: ALWAYS },
  { name: 'api snapshot', affects: ALWAYS },
  { name: 'runtime dep pins (#1557)', affects: ALWAYS },
  { name: 'npm-ci drift (#1684)', affects: ALWAYS },
  { name: 'gold-audit no-regress (#1373)', affects: ALWAYS },
  { name: 'gold-audit false-gap (#1373)', affects: ALWAYS },
  { name: 'gold registries no-false-gap (#1413)', affects: ALWAYS },
  { name: 'anti-drift: suppression rationale', affects: ALWAYS },
  { name: 'anti-drift: suppression expiry', affects: ALWAYS },
  { name: 'anti-drift: pii scan config', affects: ALWAYS },
  { name: 'anti-drift: secret scan', affects: ALWAYS },
  { name: 'anti-drift: drift manifest', affects: ALWAYS },
  { name: 'anti-drift: validator helptext', affects: ALWAYS },
  { name: 'anti-drift: tier coverage', affects: ALWAYS },
  { name: 'anti-drift: unwired guards (#2159)', affects: ALWAYS },
  { name: 'no passWithNoTests (INV-25)', affects: ALWAYS },
  { name: 'hook doc parity (CANON-10, #1838)', affects: ALWAYS },
  { name: 'feature matrix (INV-112)', affects: ALWAYS },
  { name: 'anti-proforma (INV-118)', affects: ALWAYS },
  { name: 'anti-fake-green (#1412)', affects: ALWAYS },
  {
    name: 'fixture isolation (INV-139)',
    affects: ['.arbiter/evidence/**', '.evidence/**', 'scripts/check-fixture-isolation.mjs'],
  },
  { name: 'test pyramid (INV-124)', affects: ALWAYS },
  { name: 'test scope-tier (INV-124)', affects: ALWAYS },
  { name: 'domain-api surface (INV-125)', affects: ALWAYS },
  { name: 'api e2e (INV-126)', affects: ALWAYS },
  { name: 'render smoke presence (INV-127)', affects: ALWAYS },
  { name: 'smoke journeys (INV-137)', affects: ALWAYS },
  { name: 'M16 handoff-contract marker (#2103)', affects: ALWAYS },
  { name: 'e2e escalation ladder (#2043)', affects: ALWAYS },
  { name: 'dogfood', affects: ALWAYS },
  { name: 'canon-01 declination (#1922)', affects: ALWAYS },
  { name: 'canon-15 wired gate (#1923)', affects: ALWAYS },
  { name: 'examples drift (#2222)', affects: ALWAYS },
  { name: 'emitted markdown refs (#2415)', affects: ALWAYS },
  { name: 'coverage', affects: ALWAYS },
  { name: 'coverage ratchet (#1483)', affects: ALWAYS },
  { name: 'dead code', affects: ALWAYS },
  { name: 'duplication', affects: ALWAYS },
  { name: 'skill provenance (#2428)', affects: ALWAYS },
  { name: 'audit', affects: ALWAYS },
  { name: 'consumer audit', affects: ALWAYS },
  { name: 'gitleaks', affects: ALWAYS },
  { name: 'emission coherence (INV-123)', affects: ALWAYS },
  { name: 'debt ratchet', affects: ALWAYS },
  { name: 'STRIDE/RACI traceability', affects: ALWAYS },
  { name: 'self-validation drill', affects: ALWAYS },
  { name: 'local-ci parity', affects: ALWAYS },
  { name: 'id stability', affects: ALWAYS },
  { name: 'anti-telemetry', affects: ALWAYS },
  { name: 'tdd-evidence', affects: ALWAYS },
  { name: 'codex parity (#1966)', affects: ALWAYS },
  { name: 'codex self-parity (#1966)', affects: ALWAYS },
  { name: 'todo max-age', affects: ALWAYS },
  { name: 'evidence-bundle', affects: ALWAYS },
  { name: 'agent-return envelope (E1 #1943)', affects: ALWAYS },
  {
    name: 'review completion (#2177)',
    affects: [
      'scripts/check-review-completion.mjs',
      'scripts/record-agent-return.mjs',
      'scripts/lib/agent-return-validate.mjs',
      'schemas/agent-return.schema.json',
      '.claude/commands/ship.md',
      'src/generators/check-all.ts',
      'src/templates/scripts/check-review-completion.mjs.ejs',
      'src/templates/claude/commands/ship.md.ejs',
      'src/templates/scripts/check-all.mjs.ejs',
    ],
  },
  { name: 'refutation majority (E2 #1943)', affects: ALWAYS },
  { name: 'audit dry-pass (E3 #1943)', affects: ALWAYS },
  { name: 'handoff lint (E6a #1943)', affects: ALWAYS },
  { name: 'cross-model review (#2358)', affects: ALWAYS },
  { name: 'bypass ceremony (E4 #1949)', affects: ALWAYS },
  { name: 'commit-footer rationale (INV-119)', affects: ALWAYS },
  { name: 'fail-closed audit (INV-96)', affects: ALWAYS },
  { name: 'script cohesion (INV-94)', affects: ALWAYS },
  { name: 'integration suite (INV-25)', affects: ALWAYS },
  { name: 'BDD suite (INV-25)', affects: ALWAYS },
  { name: 'conformance', affects: ALWAYS },
  // Landed on main while #2094 was in flight (#2073 acceptance anchor, #2079
  // reuse survey). ALWAYS is the safe default the header prescribes — refine
  // out of it only on evidence, never speculatively.
  { name: 'acceptance anchor (INV-138)', affects: ALWAYS },
  { name: 'reuse survey (INV-70)', affects: ALWAYS },
]

// Any changed file matching one of these forces the full gate — config/lockfiles/
// the gate machinery itself can change what EVERY check needs, so a targeted
// affects-map can't safely reason about them.
export const GATE_SKIP_BLACKLIST = [
  'package.json',
  'package-lock.json',
  'tsconfig*.json',
  'eslint.config.*',
  'vitest*.config.*',
  'Makefile',
  '.nvmrc',
  '.githooks/**',
  'scripts/check-all.mjs',
  'scripts/lib/**',
]
