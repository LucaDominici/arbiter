// SPDX-License-Identifier: Apache-2.0
// arbiter — gate-roster SSOT + CANON-25 inversion-proof ledger semantics (#2301).
//
// Two things live here, both pure (no entry point, no process.exit — see
// check-fail-closed-audit SKIP_FILES):
//
//   1. enumerateGateMechanisms(gateSrc) — the one parser for "what does scripts/check-all.mjs
//      actually run". EXTRACTED from check-canon01-declination.mjs (#1922), which still owns the
//      CANON-01 mapping but no longer owns the regex: a second consumer (the CANON-25 flip
//      harness) needs the same roster, and check-canon01-declination.mjs runs main() at import
//      time, so it cannot be imported for its exports. One parser, two consumers.
//
//   2. The CANON-25 absence-asserting family and its deferral ledger. CANON-25: for every new or
//      modified gate, name the concrete change that must turn it red and prove it by inverting
//      that change. The family scoped FIRST (issue #2301 AC-3) is the shape this defect class
//      hides in — gates that assert the ABSENCE of something, where "nothing found" and "nothing
//      looked at" are the same green:
//        - `no`      basename check-no-*          (nothing forbidden is present)
//        - `ratchet` name/basename ~ ratchet|no-regress  (nothing got worse)
//        - `parity`  name/basename ~ parity       (nothing diverged)
//      Every family member must carry a flip proof (scripts/lib/guard-flip-registry.mjs) or a row
//      in scripts/data/inversion-proof-registry.json. The ledger is BANKED — its length must equal
//      its declared ceiling AND that ceiling must equal MAX_DEFERRED below — so a NEW family gate
//      cannot be waved through by appending a row: the data file cannot authorise its own growth,
//      and the only cheap way in is a proof that the gate goes red when its condition is inverted.
//
// Deliberately NOT verified against the GitHub API: a `gh`-backed liveness check is unrunnable
// offline and in CI jobs without a token, and a check that silently no-ops in some environments is
// the very corollary this issue names (#2301 corollary 3). What the ledger's exemption actually
// buys is bounded by `expires`, which a clock verifies in EVERY environment; `issue` is recorded
// provenance and grants nothing on its own, so a fabricated number cannot widen the exemption.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Repo-relative path of the CANON-25 deferral ledger. */
export const INVERSION_REGISTRY_PATH = 'scripts/data/inversion-proof-registry.json'

/**
 * Floor on the derived absence family (#2301 review). The first cut promised, in a comment, to be
 * "fail-closed — never an empty family that would silently prove nothing", but guarded only an
 * UNREADABLE gate source: a check-all.mjs that reads fine and no longer PARSES yielded family=[],
 * owing=[] and exit 0. Measured with a readable file carrying no runCheck() call and a drained
 * ledger, the harness printed `absence-family=0 … ledger-problems=0` and exited 0 — the exact
 * blindness CANON-25 exists to catch, inside CANON-25's own enforcer.
 *
 * This is a FLOOR, not a target: wiring more absence gates raises the real count and never trips
 * it. Only a DROP fails, which is the failure mode. Lowering the pin after a deliberate gate
 * removal is then a source edit review can see, not a silent green.
 */
export const MIN_ABSENCE_FAMILY = 27

/**
 * The ledger's cardinality pin, held HERE rather than inside the ledger it governs (#2301 review).
 * cardinalityProblem() compared registry.deferred.length against registry.ceiling — two fields of
 * the SAME file — so appending a row and incrementing the ceiling in one edit passed the audit
 * completely, while CANON-25 claimed a new family gate "cannot be waved through by appending a
 * row". Anchoring the ceiling in source makes that claim true of the data file: the ledger can no
 * longer authorise its own growth. Growing it is a source edit, reviewed as one.
 */
// #2514 lowered this 16 -> 15: the "no redacted tokens" row moved out of the deferral
// ledger to a real flip proof, so the ceiling must fall with it. Unbanked improvement is
// a failure in this repo (AGENTS.md §template-tests baseline).
// #2675 raised this 15 -> 22 for seven banked candidates. #2677 lowers it 22 -> 19 after
// promoting the three workflow guards to executable bad/clean proofs.
export const MAX_DEFERRED = 19

const STRING_OR_COMMENT =
  /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//.source
const ARRAY_NESTING_TOKEN = new RegExp(`${STRING_OR_COMMENT}|[\\[\\]]`, 'g')
const ARG_TOKEN = new RegExp(`${STRING_OR_COMMENT}|[()[\\]{},]`, 'g')
const OPEN_BRACKETS = new Set(['(', '[', '{'])
const CLOSE_BRACKETS = new Set([')', ']', '}'])

function readArgArray(source, start) {
  let depth = 1
  for (const token of source.slice(start).matchAll(ARRAY_NESTING_TOKEN)) {
    if (token[0] === '[') depth++
    else if (token[0] === ']' && --depth === 0) {
      const end = start + token.index
      return { source: source.slice(start, end), end }
    }
  }
  throw new Error('unterminated runCheck argument array')
}

function topLevelArgs(source) {
  const args = []
  const stack = []
  let start = 0
  let code = ''
  let cursor = 0
  for (const match of source.matchAll(ARG_TOKEN)) {
    const token = match[0]
    const index = match.index
    code += source.slice(cursor, index)
    cursor = index + token.length
    if (token.startsWith('/')) code += ' '
    else if (token === ',' && stack.length === 0) {
      args.push({ raw: source.slice(start, index).trim(), code: code.trim(), end: index })
      start = cursor
      code = ''
    } else {
      code += token
      if (OPEN_BRACKETS.has(token)) stack.push(token)
      else if (CLOSE_BRACKETS.has(token)) stack.pop()
    }
  }
  code += source.slice(cursor)
  args.push({ raw: source.slice(start).trim(), code: code.trim(), end: source.length })
  return args
}

function singleQuotedLiteral(arg) {
  return arg.code.match(/^'((?:[^'\\]|\\.)*)'$/s)?.[1] ?? null
}

/**
 * Every mechanism invoked by check-all.mjs, in declaration order. Returns { name, tool, path }
 * where `path` is the scripts/ argument, or null for an off-the-shelf binary (external tool).
 */
export function enumerateGateMechanisms(gateSrc) {
  const re = /run(?:Check|WarnCheck|ToolCheck)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'([^']*)'\s*,\s*\[/gs
  const mechanisms = []
  let match
  while ((match = re.exec(gateSrc)) !== null) {
    const array = readArgArray(gateSrc, re.lastIndex)
    const args = topLevelArgs(array.source)
    const scriptIndex = args.findIndex((arg) => singleQuotedLiteral(arg)?.startsWith('scripts/'))
    const script = scriptIndex >= 0 ? singleQuotedLiteral(args[scriptIndex]) : null
    const argvSource = script
      ? array.source
          .slice(args[scriptIndex].end)
          .replace(/^\s*,\s*/, '')
          .trim()
      : ''
    mechanisms.push({
      name: match[1],
      tool: match[2],
      path: script,
      argv: args.slice(scriptIndex + 1).flatMap((arg) => {
        const literal = singleQuotedLiteral(arg)
        return literal === null ? [] : [literal]
      }),
      argvSource,
    })
    re.lastIndex = array.end + 1
  }
  return mechanisms
}

const STATIC_PATH_FLAGS = new Set(['--inventory', '--config'])
const POSITIONAL_SELECTORS = new Set(['all'])

function missingWiredPath(gate, repoRoot, value, source) {
  if (value && existsSync(resolve(repoRoot, value))) return []
  return [`${gate.name}: wired ${source} path does not exist: ${value || '<missing>'}`]
}

function followingLiteral(argv, index) {
  const value = argv[index + 1]
  return value !== undefined && !value.startsWith('--') ? value : null
}

function wiredGatePathProblems(gate, repoRoot) {
  const problems = []
  const argv = gate.argv ?? []
  let beforeFlags = true
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]
    if (!value.startsWith('--')) {
      if (beforeFlags && !POSITIONAL_SELECTORS.has(value))
        problems.push(...missingWiredPath(gate, repoRoot, value, 'scan root'))
      continue
    }

    beforeFlags = false
    const equals = value.match(/^(--(?:inventory|config))=(.*)$/)
    if (equals) {
      problems.push(...missingWiredPath(gate, repoRoot, equals[2], equals[1]))
      continue
    }
    if (!STATIC_PATH_FLAGS.has(value)) continue
    const next = followingLiteral(argv, i)
    problems.push(...missingWiredPath(gate, repoRoot, next ?? '', value))
    if (next !== null) i++
  }
  return problems
}

/** Missing static scan/config inputs in the real wired invocation. */
export function wiredPathProblems(family, repoRoot = process.cwd()) {
  return family.flatMap((gate) => wiredGatePathProblems(gate, repoRoot))
}

/**
 * #2560: membership was three regexes over a gate's NAME — a gate that asserts an absence but is
 * not called `check-no-*`/`ratchet`/`parity` returned `null` and sat outside the family forever,
 * never asked to prove it can go red (`check-todo-max-age.mjs` did exactly this before #2526).
 * Fixed by an explicit, declared roster (AC-1 "explicit opt-in"): membership is decided HERE, by
 * name, not derived from the name/script text at read time. A rename in check-all.mjs cannot
 * silently add or drop a family member — the roster's `script` is checked against the live wiring
 * and a mismatch is a loud error, not a fallback guess.
 *
 * Each entry preserves the exact { script, category } that was already flip-proven or ledgered —
 * `todo max-age` is the one new member #2560 adds (proof registered in guard-flip-registry.mjs).
 */
export const ABSENCE_FAMILY_ROSTER = {
  'no redacted tokens': { script: 'scripts/check-no-redacted-tokens.mjs', category: 'no' },
  'no work refs': { script: 'scripts/check-no-work-refs.mjs', category: 'no' },
  'no tracked artifacts (INV-117)': {
    script: 'scripts/check-no-tracked-artifacts.mjs',
    category: 'no',
  },
  'safety adopt ratchet (#2291)': {
    script: 'scripts/check-safety-adopt-ratchet.mjs',
    category: 'ratchet',
  },
  placeholders: { script: 'scripts/check-no-placeholders.mjs', category: 'no' },
  'i18n raw strings': { script: 'scripts/check-no-raw-strings.mjs', category: 'no' },
  'orphan TODOs': { script: 'scripts/check-no-orphan-todo.mjs', category: 'no' },
  'no direct-fs outside the façade': { script: 'scripts/check-no-direct-fs.mjs', category: 'no' },
  'catalog parity': { script: 'scripts/check-catalog-agents-parity.mjs', category: 'parity' },
  'global-invariants parity': {
    script: 'scripts/check-global-invariants-parity.mjs',
    category: 'parity',
  },
  'kit catalog parity': { script: 'scripts/check-kit-catalog-parity.mjs', category: 'parity' },
  'bloat ratchet': { script: 'scripts/check-bloat-ratchet.mjs', category: 'ratchet' },
  'cli ref parity (INV-111)': { script: 'scripts/gen-cli-ref.mjs', category: 'parity' },
  'version parity (#1838)': { script: 'scripts/check-version-parity.mjs', category: 'parity' },
  'canon enforcement parity (B1)': {
    script: 'scripts/check-canon-enforcement-parity.mjs',
    category: 'parity',
  },
  'action pin parity': { script: 'scripts/sync-action-pins.mjs', category: 'parity' },
  'gold-audit no-regress (#1373)': { script: 'scripts/gold-audit.mjs', category: 'ratchet' },
  'ci tool parity': { script: 'scripts/check-ci-tool-parity.mjs', category: 'parity' },
  'hook doc parity (CANON-10, #1838)': {
    script: 'scripts/check-hook-doc-parity.mjs',
    category: 'parity',
  },
  'no passWithNoTests (INV-25)': {
    script: 'scripts/check-no-passwithnotests.mjs',
    category: 'no',
  },
  'kernel plugin parity (#2548)': {
    script: 'scripts/check-kernel-plugin-parity.mjs',
    category: 'parity',
  },
  'coverage ratchet (#1483)': { script: 'scripts/check-coverage-ratchet.mjs', category: 'ratchet' },
  'complexity ratchet (preventive)': { script: 'scripts/debt-report.mjs', category: 'ratchet' },
  'public API ratchet (preventive)': { script: 'scripts/debt-report.mjs', category: 'ratchet' },
  'debt ratchet': { script: 'scripts/debt-report.mjs', category: 'ratchet' },
  'local-ci parity': { script: 'scripts/check-local-ci-parity.mjs', category: 'parity' },
  'codex parity (#1966)': { script: 'scripts/check-codex-parity.mjs', category: 'parity' },
  'codex self-parity (#1966)': {
    script: 'scripts/check-codex-self-parity.mjs',
    category: 'parity',
  },
  'todo max-age': { script: 'scripts/check-todo-max-age.mjs', category: 'no' },
  // #2675 — promoted from ABSENCE_EXEMPT with a real flip proof (guard-flip-registry.mjs):
  // each of these already reads its scan root from an argv flag (--dir/--root/--patterns/
  // --gate), so a synthetic bad/clean fixture pair needed no new injection point.
  'anti-drift: secret scan': { script: 'scripts/check-secret-scan.mjs', category: 'no' },
  'anti-drift: validator helptext': {
    script: 'scripts/check-validator-helptext.mjs',
    category: 'no',
  },
  'anti-drift: drift manifest': { script: 'scripts/check-drift.mjs', category: 'parity' },
  'anti-drift: workflow docs sync': {
    script: 'scripts/check-workflow-docs-sync.mjs',
    category: 'parity',
  },
  'npm-ci drift (#1684)': { script: 'scripts/check-npm-ci-drift.mjs', category: 'parity' },
  'anti-drift: pii scan config': { script: 'scripts/check-pii-scan.mjs', category: 'no' },
  'anti-drift: tier coverage': { script: 'scripts/check-tier-coverage.mjs', category: 'no' },
  'anti-drift: suppression rationale': {
    script: 'scripts/check-suppression-rationale.mjs',
    category: 'no',
  },
  'anti-drift: suppression expiry': {
    script: 'scripts/check-suppression-expiry.mjs',
    category: 'no',
  },
  'anti-drift: pr size gate': { script: 'scripts/check-pr-size-gate.mjs', category: 'no' },
  'anti-drift: workflow runners': {
    script: 'scripts/check-workflow-runners.mjs',
    category: 'no',
  },
  'anti-drift: docker action runner safety (#1756)': {
    script: 'scripts/check-docker-action-runner-safety.mjs',
    category: 'no',
  },
  // #2675 — promoted from ABSENCE_EXEMPT with a ledger row (scripts/data/inversion-proof-registry.json)
  // rather than a flip proof: each needs a generator-style fixture or a fixture over intricate
  // multi-surface parsing that this pass did not attempt (see the row's `reason` for specifics).
  'llms.txt drift (#1721)': { script: 'scripts/gen-llms-txt.mjs', category: 'parity' },
  'api snapshot': { script: 'scripts/check-api-snapshot.mjs', category: 'parity' },
  'gold registries no-false-gap (#1413)': {
    script: 'scripts/check-gold-registries.mjs',
    category: 'ratchet',
  },
  'anti-drift: workflow integrity': {
    script: 'scripts/check-workflow-test-integrity.mjs',
    category: 'no',
  },
  'anti-drift: workflow parallelism (INV-120)': {
    script: 'scripts/check-workflow-parallelism.mjs',
    category: 'ratchet',
  },
  'anti-drift: unwired guards (#2159)': {
    script: 'scripts/check-unwired-guards.mjs',
    category: 'no',
  },
  'examples drift (#2222)': { script: 'scripts/regenerate-examples.mjs', category: 'parity' },
}

/**
 * #2560 AC-3: wired mechanisms this issue identified as absence-asserting but deliberately NOT
 * added to the family in this PR — named with a reason so the exclusion is reviewable, not a
 * silent `null`. This is the enumerated list the issue asked for: the "anti-drift" (INV-89) family
 * reads live repo state via process.cwd() with no fixture-injection flag (the same shape #2301
 * already deferred 15 gates for), so proving each needs the same per-gate fixture work as the
 * deferral ledger — sized here, not attempted in this slice.
 *
 * Every entry is machine-validated by `exemptionProblem` below (Codex round-1 finding #2): `script`
 * must match the live wiring (else stale — a renamed/removed gate exempts nothing), `reason` must
 * carry at least 3 words (not a placeholder), and `followUp` must cite a real tracking issue — an
 * exemption is a promise to come back, and a promise with no ticket is not one. Tracked in #2675:
 * promote each to the roster with a flip proof, or a dated `inversion-proof-registry.json` row.
 */
// #2675: the last 7 of the original 19 candidates were promoted straight to a ledger row
// (scripts/data/inversion-proof-registry.json) rather than a flip proof — each needs either a
// generator-style fixture (llms.txt/api-snapshot/gold-registries/examples: diffing generated
// output against a committed artifact, not a single planted file) or a fixture over intricate
// multi-surface parsing (workflow-test-integrity/workflow-parallelism's YAML DAG logic,
// unwired-guards' many hardcoded scan roots) that risked a brittle, false-discriminating proof
// at this pass's scope. ABSENCE_EXEMPT is empty: nothing here still awaits classification.
export const ABSENCE_EXEMPT = {}

/**
 * #2560 Codex round-1 finding #1: a wired mechanism that trips no candidate heuristic used to
 * return `[]` (excluded) SILENTLY — the exact escape this issue exists to close, just moved one
 * level up. Fail-closed now means EVERY wired mechanism in check-all.mjs must be classified into
 * exactly one of three declared buckets: ABSENCE_FAMILY_ROSTER (proven or ledgered), ABSENCE_EXEMPT
 * (identified absence-asserting, promotion deferred, tracked in #2675), or NOT_ABSENCE (declared,
 * by a human, NOT absence-asserting — a presence/build/lint/doc check). A mechanism in none of the
 * three is a loud `exitCode: 2` error, never a silent `null`/`[]` exclusion — no heuristic decides
 * membership, a declaration does, so a gate cannot escape by carrying a name no regex anticipated.
 *
 * Generated as a one-time audit sweep over every mechanism `enumerateGateMechanisms` did not
 * already place in the family or the exemption list; each entry's `script` is checked against the
 * live wiring for drift exactly like the other two tables (a rename here is caught, not ignored).
 */
export const NOT_ABSENCE = {
  build: { script: null },
  'build-kit': { script: 'scripts/build-kit.mjs' },
  'private paths ignored': { script: 'scripts/check-private-paths-ignored.mjs' },
  'hook routing (#2129)': { script: 'scripts/check-hook-routing.mjs' },
  typecheck: { script: null },
  format: { script: null },
  lint: { script: null },
  'circular deps': { script: null },
  'spdx headers': { script: 'scripts/check-spdx-headers.mjs' },
  'PII scan': { script: 'scripts/pii-scan.mjs' },
  'inline suppressions': { script: 'scripts/check-inline-suppressions.mjs' },
  'suppressions expiry': { script: 'scripts/check-suppressions.mjs' },
  commitlint: { script: null },
  'test naming': { script: 'scripts/check-test-naming.mjs' },
  'hardness inventory': { script: 'scripts/check-hardness-inventory.mjs' },
  'hardness inventory (self hooks)': { script: 'scripts/check-hardness-inventory.mjs' },
  docs: { script: 'scripts/check-docs.mjs' },
  'install command (B1)': { script: 'scripts/check-install-command.mjs' },
  'tool claims': { script: 'scripts/check-tool-claims.mjs' },
  'third-party licenses': { script: 'scripts/gen-third-party-licenses.mjs' },
  'matrix fixtures': { script: 'scripts/check-matrix-fixtures.mjs' },
  'matrix proven cells': { script: 'scripts/check-matrix-proven-cells.mjs' },
  'skills-matrix-schema': { script: 'scripts/check-skills-matrix.mjs' },
  'tabletop evidence (#2429)': { script: 'scripts/check-tabletop-evidence.mjs' },
  'template tests': { script: 'scripts/check-template-tests.mjs' },
  'emitted formatting (#2571)': { script: 'scripts/check-emitted-formatting.mjs' },
  'generator tests': { script: 'scripts/check-generator-tests.mjs' },
  'command tests': { script: 'scripts/check-command-tests.mjs' },
  'brownfield tests (CANON-11)': { script: 'scripts/check-brownfield-tests.mjs' },
  'enforcement wired': { script: 'scripts/check-inv-enforcement-wired.mjs' },
  'id registry (INV-140)': { script: 'scripts/check-id-registry.mjs' },
  'ontology wired (INV-141)': { script: 'scripts/check-ontology-wired.mjs' },
  'arc42 slots (INV-144)': { script: 'scripts/check-arc42-slots.mjs' },
  'milestones (INV-146)': { script: 'scripts/check-milestones.mjs' },
  'runbook coverage (INV-148)': { script: 'scripts/check-runbook-coverage.mjs' },
  'use cases (INV-149)': { script: 'scripts/check-use-cases.mjs' },
  'sources tier 1 (INV-147)': { script: 'scripts/check-sources.mjs' },
  'forma schema contract (INV-143)': { script: 'scripts/check-forma-contract.mjs' },
  'orchestrator coverage (#1410)': { script: 'scripts/check-orchestrator-coverage.mjs' },
  'constraint scan (INV-115)': { script: 'scripts/check-constraint-scan.mjs' },
  'agent-dispatch matrix (#1267)': { script: 'scripts/check-agent-dispatch.mjs' },
  'wiki lint (INV-116)': { script: 'scripts/check-wiki-lint.mjs' },
  'node version ssot': { script: 'scripts/check-node-version-ssot.mjs' },
  'exit code contract': { script: 'scripts/check-exit-code-contract.mjs' },
  'pipe/tee hazard': { script: 'scripts/check-pipe-tee-hazard.mjs' },
  'ssot core': { script: 'scripts/check-ssot-core.mjs' },
  'doc links': { script: 'scripts/check-doc-links.mjs' },
  'governance mirror sync (#1805)': { script: 'scripts/check-governance-mirror-sync.mjs' },
  'doc style': { script: 'scripts/check-doc-style.mjs' },
  'orchestration integrity (#2387)': { script: 'scripts/check-orchestration-integrity.mjs' },
  'claude-md lint (#1266)': { script: 'scripts/check-claude-md-lint.mjs' },
  'doc index (#1102)': { script: 'scripts/gen-doc-index.mjs' },
  'status dashboard': { script: 'scripts/gen-status.mjs' },
  'derived pages (#1838)': { script: 'scripts/gen-derived-pages.mjs' },
  'gap register': { script: 'scripts/gen-gap.mjs' },
  'ssot core index (#1100)': { script: 'scripts/gen-ssot-core.mjs' },
  'adr index (INV-107)': { script: 'scripts/check-adr-index.mjs' },
  'adr digest (INV-107)': { script: 'scripts/gen-adr-readme.mjs' },
  'adr enforcement linkage (#1473)': { script: 'scripts/check-adr-enforcement.mjs' },
  'bypass ceremony (E4 #1949)': { script: 'scripts/check-bypass-ceremony.mjs' },
  'phantom command scan (INV-111 ext, #1838)': { script: 'scripts/check-phantom-command-scan.mjs' },
  'doc path citations (#2243)': { script: 'scripts/check-doc-path-citations.mjs' },
  'phase doc consistency (INV-113)': { script: 'scripts/check-phase-doc-consistency.mjs' },
  'acceptance anchor (INV-138)': { script: 'scripts/check-acceptance.mjs' },
  'canonical paths': { script: 'scripts/check-canonical-paths.mjs' },
  'canon references': { script: 'scripts/check-canon-references.mjs' },
  'canon-15 wired gate (#1923)': { script: 'scripts/check-canon15-wired-gate.mjs' },
  'plugin api stability': { script: 'scripts/check-plugin-api-stability.mjs' },
  deprecations: { script: 'scripts/check-deprecations.mjs' },
  'hook contracts': { script: 'scripts/check-hook-contracts.mjs' },
  'ci tiers (INV-73)': { script: 'scripts/check-ci-tiers.mjs' },
  'action pin sha (INV-76)': { script: 'scripts/check-action-pins.mjs' },
  'runtime dep pins (#1557)': { script: 'scripts/check-runtime-dep-pins.mjs' },
  'workflow hardening (INV-76/95)': { script: 'scripts/check-workflow-hardening.mjs' },
  'gold-audit false-gap (#1373)': { script: 'scripts/gold-audit.mjs' },
  actionlint: { script: null },
  'perm-test guards': { script: 'scripts/check-perm-test-guards.mjs' },
  'deploy cosign supply-chain (INV-95/97/98)': { script: 'scripts/check-workflow-cosign.mjs' },
  'collab mode wired (INV-100)': { script: 'scripts/check-collab-mode-wired.mjs' },
  'merge method ff-only (INV-101)': { script: 'scripts/check-merge-method.mjs' },
  'settings coverage (#1121)': { script: 'scripts/check-settings-coverage.mjs' },
  'methodology coverage (#2039)': { script: 'scripts/check-methodology-coverage.mjs' },
  'feature matrix (INV-112)': { script: 'scripts/check-feature-matrix.mjs' },
  'anti-proforma (INV-118)': { script: 'scripts/check-anti-proforma.mjs' },
  'anti-fake-green (#1412)': { script: 'scripts/check-anti-fake-green.mjs' },
  'fixture isolation (INV-139)': { script: 'scripts/check-fixture-isolation.mjs' },
  'test pyramid (INV-124)': { script: 'scripts/check-test-pyramid.mjs' },
  'test scope-tier (INV-124)': { script: 'scripts/check-test-scope-tier.mjs' },
  'domain-api surface (INV-125)': { script: 'scripts/check-domain-api-surface.mjs' },
  'api e2e (INV-126)': { script: 'scripts/check-api-e2e.mjs' },
  'render smoke presence (INV-127)': { script: 'scripts/check-render-smoke.mjs' },
  'smoke journeys (INV-137)': { script: 'scripts/check-smoke-journeys.mjs' },
  'M16 handoff-contract marker (#2103)': { script: 'scripts/check-m16-handoff.mjs' },
  'e2e escalation ladder (#2043)': { script: 'scripts/check-e2e-escalation.mjs' },
  'workflow cache strategy (§17.5 rec 3)': { script: 'scripts/check-workflow-cache-strategy.mjs' },
  'build-cache strategy (C3)': { script: 'scripts/check-build-cache-strategy.mjs' },
  dogfood: { script: 'scripts/check-self-dogfood.mjs' },
  'canon-01 declination (#1922)': { script: 'scripts/check-canon01-declination.mjs' },
  'emitted markdown refs (#2415)': { script: 'scripts/check-emitted-markdown-refs.mjs' },
  'unit tests': { script: null },
  'greenfield smoke': { script: null },
  coverage: { script: null },
  'dead code': { script: null },
  duplication: { script: 'scripts/check-duplication.mjs' },
  'skill provenance (#2428)': { script: 'scripts/check-skill-provenance.mjs' },
  audit: { script: null },
  'consumer audit': { script: 'scripts/check-consumer-audit.mjs' },
  gitleaks: { script: null },
  'emission coherence (INV-123)': { script: 'scripts/check-emission-coherence.mjs' },
  'STRIDE/RACI traceability': { script: 'scripts/check-stride-traceability.mjs' },
  'self-validation drill': { script: 'scripts/self-validation.mjs' },
  'id stability': { script: 'scripts/check-id-stability.mjs' },
  'anti-telemetry': { script: 'scripts/check-anti-telemetry.mjs' },
  'tdd-evidence': { script: 'scripts/check-tdd-evidence.mjs' },
  'evidence-bundle': { script: 'scripts/check-evidence-bundle.mjs' },
  'agent-return envelope (E1 #1943)': { script: 'scripts/check-agent-return.mjs' },
  'cross-model review (#2358)': { script: 'scripts/check-cross-model-review.mjs' },
  'review completion (#2177)': { script: 'scripts/check-review-completion.mjs' },
  'refutation majority (E2 #1943)': { script: 'scripts/check-refutation-verdicts.mjs' },
  'audit dry-pass (E3 #1943)': { script: 'scripts/check-audit-dry-pass.mjs' },
  'handoff lint (E6a #1943)': { script: 'scripts/check-handoff-doc.mjs' },
  'reuse survey (INV-70)': { script: 'scripts/check-reuse-survey.mjs' },
  'commit-footer rationale (INV-119)': { script: 'scripts/check-commit-footer-rationale.mjs' },
  'fail-closed audit (INV-96)': { script: 'scripts/check-fail-closed-audit.mjs' },
  'script cohesion (INV-94)': { script: 'scripts/check-script-cohesion.mjs' },
  'BDD suite (INV-25)': { script: null },
  conformance: { script: 'scripts/conformance.mjs' },
  'doc-set presence': { script: 'scripts/check-doc-set.mjs' },
}

/**
 * The absence-asserting gate family derived from check-all.mjs source, resolved against the
 * declared ABSENCE_FAMILY_ROSTER (#2560) — never against the mechanism's own name/script text.
 * Each entry is shaped like a flip-harness roster entry ({ name, script }) plus its category, so
 * the harness can run it directly against its registered fixtures.
 *
 * Every wired mechanism must be classified into exactly one of three declared buckets — roster,
 * NOT_ABSENCE, or exempt — a heuristic decides nothing (Codex round-1 finding #1). Fail-closed on
 * drift between any table and the live wiring, on an invalid exemption entry, and on a mechanism
 * in none of the three tables: all three throw `exitCode: 2` (ERROR, not a shortened PASS).
 *
 * `roster`/`notAbsence`/`exempt` default to the real declarations above; a `--roster` fixture
 * (check-guard-flip self-tests) passes its own tiny contract instead, exactly as `--registry`/
 * `--max-deferred` already let a fixture declare its own ledger — the production pins are what CI
 * actually runs.
 */
/** A roster entry whose declared script disagrees with the live wiring — a stale/renamed row. */
function rosterDriftError(table, name, declaredScript, wiredPath) {
  return Object.assign(
    new Error(
      `${table}['${name}'] declares script ${declaredScript} but check-all.mjs wires ${wiredPath} ` +
        `— update the entry in gate-roster.mjs`,
    ),
    { exitCode: 2 },
  )
}

/** A wired mechanism declared in NONE of ABSENCE_FAMILY_ROSTER/NOT_ABSENCE/ABSENCE_EXEMPT. */
function unclassifiedError(name, path) {
  return Object.assign(
    new Error(
      `unclassified wired gate '${name}' (${path ?? 'external tool'}) — every mechanism in ` +
        `check-all.mjs must be declared in exactly one of ABSENCE_FAMILY_ROSTER (proven or ` +
        `ledgered), NOT_ABSENCE (declared not absence-asserting), or ABSENCE_EXEMPT (identified, ` +
        `promotion deferred) in gate-roster.mjs. A gate must not be able to escape the flip-proof ` +
        `requirement by carrying a name no table anticipated (#2560).`,
    ),
    { exitCode: 2 },
  )
}

/**
 * A wired mechanism declared in MORE THAN ONE table (Codex round-2 finding #1). Precedence order
 * would silently pick a winner and hide the conflict; a gate cannot simultaneously be proven
 * absence-asserting, declared not absence-asserting, and identified-but-deferred, so this is
 * always a data error in gate-roster.mjs, never a legitimate double-declaration.
 */
function duplicateMembershipError(name, tableNames) {
  return Object.assign(
    new Error(
      `wired gate '${name}' is declared in more than one table (${tableNames.join(', ')}) — ` +
        `membership must be exactly one of ABSENCE_FAMILY_ROSTER/NOT_ABSENCE/ABSENCE_EXEMPT; ` +
        `remove it from all but one in gate-roster.mjs`,
    ),
    { exitCode: 2 },
  )
}

/**
 * A table row naming a gate that is NOT wired in check-all.mjs (Codex round-2 finding #1). A
 * stale row exempts/declares nothing real — a removed or renamed gate must have its row removed
 * or updated, not left behind to silently pass an audit of a gate that no longer exists.
 */
function staleRowError(table, name) {
  return Object.assign(
    new Error(
      `${table}['${name}'] names a gate that is not wired in check-all.mjs — a stale row is not ` +
        `visited by the classification walk and would silently exempt/declare nothing; remove it`,
    ),
    { exitCode: 2 },
  )
}

const FOLLOW_UP_ISSUE = /^#\d+$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A YYYY-MM-DD string that round-trips through Date parsing — rejects e.g. `2026-99-99`. */
function isValidCalendarDate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Problems with `entry.until` specifically, or null (Codex round-2 finding #2: shape is not enough). */
function untilProblem(name, until, now) {
  if (!isValidCalendarDate(until)) {
    return `ABSENCE_EXEMPT['${name}'] has an \`until\` that is not a real calendar date (YYYY-MM-DD): ${until}`
  }
  if (new Date(`${until}T00:00:00Z`).getTime() < now.getTime()) {
    return `ABSENCE_EXEMPT['${name}'] expired exemption — \`until\` (${until}) is in the past; promote the gate or extend the date`
  }
  return null
}

/** Problems with one ABSENCE_EXEMPT entry, or null when it is sound (Codex round-1 finding #2). */
function exemptionProblem(name, entry, wiredPath, now) {
  if (entry.script !== wiredPath) {
    return (
      `ABSENCE_EXEMPT['${name}'] declares script ${entry.script} but check-all.mjs wires ` +
      `${wiredPath} — a stale exemption exempts nothing; update or remove the entry`
    )
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim().split(/\s+/).length < 3) {
    return `ABSENCE_EXEMPT['${name}'] needs a \`reason\` of at least 3 words, not a placeholder`
  }
  if (entry.until !== undefined) {
    const problem = untilProblem(name, entry.until, now)
    if (problem) return problem
  }
  const hasUntil = typeof entry.until === 'string'
  const hasFollowUp = typeof entry.followUp === 'string' && FOLLOW_UP_ISSUE.test(entry.followUp)
  if (!hasUntil && !hasFollowUp) {
    return (
      `ABSENCE_EXEMPT['${name}'] needs an \`until\` date (YYYY-MM-DD) or a \`followUp\` issue ` +
      `('#NNN') — an exemption with no ticket and no expiry is a permanent, unreviewed exclusion`
    )
  }
  return null
}

/** Which of the three tables declare `name` — length > 1 is a duplicate-membership error. */
function tableMembership(name, { roster, notAbsence, exempt }) {
  const hits = []
  if (roster[name]) hits.push('ABSENCE_FAMILY_ROSTER')
  if (notAbsence[name]) hits.push('NOT_ABSENCE')
  if (exempt[name]) hits.push('ABSENCE_EXEMPT')
  return hits
}

/**
 * Classify one wired mechanism against the three declared tables. Returns a family entry, or
 * `null` when the mechanism is declared NOT_ABSENCE or validly exempt (present, not a member).
 * Throws (exitCode: 2) on: membership in zero or more-than-one table, roster/NOT_ABSENCE script
 * drift, or an invalid exemption — every path is a decision made by a table, never a guess.
 */
function classifyMechanism(mech, tables, now) {
  const hits = tableMembership(mech.name, tables)
  if (hits.length > 1) throw duplicateMembershipError(mech.name, hits)
  if (hits.length === 0) throw unclassifiedError(mech.name, mech.path)

  if (hits[0] === 'ABSENCE_FAMILY_ROSTER') {
    const declared = tables.roster[mech.name]
    if (declared.script !== mech.path)
      throw rosterDriftError('ABSENCE_FAMILY_ROSTER', mech.name, declared.script, mech.path)
    return {
      name: mech.name,
      script: mech.path,
      category: declared.category,
      argv: mech.argv,
      argvSource: mech.argvSource,
    }
  }
  if (hits[0] === 'NOT_ABSENCE') {
    const notAbsenceEntry = tables.notAbsence[mech.name]
    if (notAbsenceEntry.script !== mech.path)
      throw rosterDriftError('NOT_ABSENCE', mech.name, notAbsenceEntry.script, mech.path)
    return null
  }
  const exemption = tables.exempt[mech.name]
  const problem = exemptionProblem(mech.name, exemption, mech.path, now)
  if (problem) throw Object.assign(new Error(problem), { exitCode: 2 })
  return null
}

/** Every row in every table not visited as a wired mechanism — a stale row (Codex round-2 #1). */
function assertNoStaleRows(wiredNames, tables) {
  for (const [tableName, table] of Object.entries(tables)) {
    const label =
      tableName === 'roster'
        ? 'ABSENCE_FAMILY_ROSTER'
        : tableName === 'notAbsence'
          ? 'NOT_ABSENCE'
          : 'ABSENCE_EXEMPT'
    for (const name of Object.keys(table)) {
      if (!wiredNames.has(name)) throw staleRowError(label, name)
    }
  }
}

export function deriveAbsenceFamily(
  gateSrc,
  {
    roster = ABSENCE_FAMILY_ROSTER,
    notAbsence = NOT_ABSENCE,
    exempt = ABSENCE_EXEMPT,
    now = new Date(),
  } = {},
) {
  const seen = new Set()
  const family = []
  const tables = { roster, notAbsence, exempt }
  for (const mech of enumerateGateMechanisms(gateSrc)) {
    if (seen.has(mech.name)) continue
    seen.add(mech.name)
    const entry = classifyMechanism(mech, tables, now)
    if (entry) family.push(entry)
  }
  assertNoStaleRows(seen, tables)
  return family
}

/**
 * The flip proof covering `gate`, or null. Looked up by check name first, then by SCRIPT: a gate
 * wired under a second name (check-no-passwithnotests is both the INV-25 gate and the
 * anti-fake-green `no-empty-suite` guard) is already proven, and a duplicate fixture would be
 * dead weight, not extra assurance.
 */
export function flipProofFor(gate, registry, roster = []) {
  if (registry[gate.name]) return registry[gate.name]
  for (const other of roster) {
    if (
      other.script === gate.script &&
      (other.argvSource ?? '') === (gate.argvSource ?? '') &&
      registry[other.name]
    )
      return registry[other.name]
  }
  return null
}

/** Read the deferral ledger from `root`. Throws on missing/malformed JSON — callers fail closed. */
export function loadInversionRegistry(root) {
  return JSON.parse(readFileSync(join(root, INVERSION_REGISTRY_PATH), 'utf-8'))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MIN_REASON_CHARS = 30

/** Row label for diagnostics — the gate name when present, a placeholder otherwise. */
function rowLabel(row) {
  return typeof row?.gate === 'string' && row.gate !== '' ? row.gate : '<row without a gate>'
}

/** Does the row still describe a gate the live derivation agrees with? */
function identityProblem(row, label, byName) {
  const gate = byName.get(row.gate)
  if (!gate) {
    return (
      `${label}: not in the absence-asserting family derived from check-all.mjs — a row for a ` +
      `gate that is not wired (or was renamed) exempts nothing and must be removed`
    )
  }
  if (row.script !== gate.script) {
    return `${label}: row declares script ${String(row.script)} but check-all.mjs wires ${gate.script}`
  }
  if (row.category !== gate.category) {
    return `${label}: row declares category ${String(row.category)} but the gate derives as ${gate.category}`
  }
  return null
}

/** A reasonless (or near-reasonless) row is a blanket exemption. */
function reasonProblem(row, label) {
  if (typeof row.reason === 'string' && row.reason.trim().length >= MIN_REASON_CHARS) return null
  return (
    `${label}: needs a \`reason\` of at least ${MIN_REASON_CHARS} characters naming why no ` +
    `inversion fixture exists yet — a reasonless row is a blanket exemption`
  )
}

/** Provenance must be a real issue NUMBER, not free text that merely looks like a reference. */
function issueProblem(row, label) {
  if (Number.isInteger(row.issue) && row.issue > 0) return null
  return `${label}: \`issue\` must be a positive integer (provenance for the deferral)`
}

/** The only currency the exemption actually spends: a date a clock can check anywhere. */
function expiryProblem(row, label, now) {
  if (typeof row.expires !== 'string' || !ISO_DATE.test(row.expires)) {
    return `${label}: \`expires\` must be a YYYY-MM-DD date — a deferral without an end`
  }
  const due = new Date(`${row.expires}T00:00:00Z`)
  if (Number.isNaN(due.getTime())) return `${label}: unparseable \`expires\` (${row.expires})`
  if (due.getTime() < now.getTime()) {
    return (
      `${label}: deferral expired ${row.expires} — write the inversion fixture or re-decide; ` +
      `audit-mode is a stage, not a destination`
    )
  }
  return null
}

/** Problems with one ledger row, given the derived family indexed by gate name. */
function rowProblems(row, byName, now) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return ['ledger row is not an object']
  }
  if (typeof row.gate !== 'string' || row.gate === '') {
    return ['ledger row without a `gate` name']
  }
  const label = rowLabel(row)
  return [
    identityProblem(row, label, byName),
    reasonProblem(row, label),
    issueProblem(row, label),
    expiryProblem(row, label, now),
  ].filter((p) => p !== null)
}

/** Fail-closed shape check: an unauditable ledger is a problem, never an empty pass. */
function shapeProblem(registry) {
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    return 'inversion-proof ledger is not an object'
  }
  if (!Array.isArray(registry.deferred)) return 'inversion-proof ledger has no `deferred` array'
  if (!Number.isInteger(registry.ceiling) || registry.ceiling < 0) {
    return 'inversion-proof ledger has no non-negative integer `ceiling`'
  }
  return null
}

/**
 * The ratchet, binding in BOTH directions: above the ceiling is a regression, below it is an
 * unbanked improvement whose slack could be silently re-filled later.
 *
 * `pinnedCeiling` is the ceiling the CALLER holds — MAX_DEFERRED for the real ledger. Checking it
 * first is what stops the ledger authorising its own growth (#2301 review): without it, the only
 * comparison was deferred.length vs registry.ceiling, both fields of the same file, so one edit
 * incrementing both passed. A `--registry` fixture passes its own declared ceiling here, which
 * restores the fixture-local semantics the harness's self-tests need.
 */
function cardinalityProblem(registry, pinnedCeiling) {
  const n = registry.deferred.length
  if (registry.ceiling !== pinnedCeiling) {
    return (
      `deferral ledger declares a ceiling of ${registry.ceiling} but the pin in gate-roster.mjs ` +
      `is ${pinnedCeiling} — the ledger cannot authorise its own growth: move MAX_DEFERRED, in ` +
      `source, where review sees it`
    )
  }
  if (n > registry.ceiling) {
    return (
      `deferral ledger holds ${n} rows over a ceiling of ${registry.ceiling} — the ratchet is ` +
      `non-increasing: prove the gate by inversion instead of adding a row`
    )
  }
  if (n < registry.ceiling) {
    return (
      `deferral ledger holds ${n} rows under a ceiling of ${registry.ceiling} — unbanked ` +
      `improvement: lower the ceiling to ${n} so the slack cannot be silently re-filled`
    )
  }
  return null
}

/**
 * Audit the CANON-25 deferral ledger against the derived family. Returns the list of problems
 * (empty ⇒ the ledger is sound).
 */
export function auditInversionRegistry({
  family,
  registry,
  now = new Date(),
  pinnedCeiling = MAX_DEFERRED,
}) {
  const shape = shapeProblem(registry)
  if (shape !== null) return [shape]

  const problems = []
  const cardinality = cardinalityProblem(registry, pinnedCeiling)
  if (cardinality !== null) problems.push(cardinality)

  const byName = new Map(family.map((f) => [f.name, f]))
  const seen = new Set()
  for (const row of registry.deferred) {
    problems.push(...rowProblems(row, byName, now))
    const key = row?.gate
    if (typeof key !== 'string') continue
    if (seen.has(key)) problems.push(`${key}: duplicate ledger row`)
    seen.add(key)
  }
  return problems
}
