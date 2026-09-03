#!/usr/bin/env node
// check-local-ci-parity.mjs — local↔CI gate result parity check (INV-59, INV-87, #470, #879, #1225, #2042)
//
// 1. Runtime check: reads .arbiter/gate/local-result.json and latest CI gate-result artifact,
//    compares parityContentHash. On mismatch, prints diff and exits 1.
// 2. Static check (#879, W3, INV-87): parses Makefile .PHONY targets and .github/workflows/
//    job names, compares the set. Skip-neutral when either source is absent.
//    Set PARITY_STATIC_CHECK_ONLY=1 to run only the static check (testing).
// 3. Check-level parity (#1225, bidirectional per #2042): extracts all runCheck/runToolCheck
//    call IDs from scripts/check-all.mjs, then asserts (a) every ID appears in CI_COVERAGE or
//    CI_SKIP_SET (forward), and (b) every CI_COVERAGE job-name value is a real, current job in
//    .github/workflows/*.yml (reverse — catches a job rename/removal silently desyncing the map).
//    Set PARITY_CHECK_LEVEL_ONLY=1 to run only this check (testing).
//
// Exit codes:
//   0 — hashes match, or no CI artifact available (neutral skip)
//   1 — hash mismatch (parity drift detected) or static drift detected
//   2 — invocation error (parse failure, bad artifact schema)
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()

// ─── Shared workflow job-name parsing (#879, #2042) ───────────────────────────

/** Extract top-level job IDs from a single workflow YAML file's contents. */
function parseWorkflowJobNames(content) {
  const jobs = new Set()
  const lines = content.split('\n')
  let inJobs = false
  for (const line of lines) {
    if (line === 'jobs:') {
      inJobs = true
      continue
    }
    if (inJobs && /^\S/.test(line) && line !== '') {
      inJobs = false
      continue
    }
    if (inJobs) {
      const m = line.match(/^  ([\w][\w-]*):/)
      if (m) jobs.add(m[1])
    }
  }
  return jobs
}

/**
 * Read all job IDs declared across .github/workflows/*.yml under root.
 * Returns null (neutral — caller should skip) when the dir is absent, unreadable,
 * or has no workflow files.
 */
function readWorkflowJobNames(root) {
  const wfDir = join(root, '.github', 'workflows')
  if (!existsSync(wfDir)) return null
  let wfFiles
  try {
    wfFiles = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  } catch {
    return null
  }
  if (wfFiles.length === 0) return null

  const jobs = new Set()
  for (const wfFile of wfFiles) {
    const content = readFileSync(join(wfDir, wfFile), 'utf-8')
    for (const job of parseWorkflowJobNames(content)) jobs.add(job)
  }
  return jobs
}

// ─── Static Makefile↔workflow parity check (INV-87, #879, W3) ────────────────

// Targets that are expected to be local-only (no CI counterpart required).
const STATIC_PARITY_EXCLUDE = new Set([
  'help',
  'clean',
  'evidence',
  'simulate-nightly',
  'simulate-weekly',
  // Local convenience aliases — no direct CI job equivalent
  'check', // local L1 alias (CI runs individual jobs, not a single 'check' job)
  'full', // local L2+coverage (CI runs coverage as part of pr-extended)
  'ci', // alias for gate (delegates to gate target in Makefile)
])

function checkStaticParity(root) {
  const makefilePath = join(root, 'Makefile')
  if (!existsSync(makefilePath)) {
    process.stdout.write(
      '[skip] static parity: Makefile absent — skipping static Makefile↔workflow check\n',
    )
    return 0
  }

  const wfDir = join(root, '.github', 'workflows')
  if (!existsSync(wfDir)) {
    process.stdout.write(
      '[skip] static parity: .github/workflows absent — skipping static Makefile↔workflow check\n',
    )
    return 0
  }

  let wfFiles
  try {
    wfFiles = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  } catch (err) {
    if (err.code === 'ENOENT') return 0
    process.stderr.write(
      `check-local-ci-parity: ERROR — cannot read .github/workflows: ${err.message}\n`,
    )
    return 2
  }

  if (wfFiles.length === 0) {
    process.stdout.write(
      '[skip] static parity: no workflow files found — skipping static Makefile↔workflow check\n',
    )
    return 0
  }

  const makeContent = readFileSync(makefilePath, 'utf-8')
  const phonyMatch = makeContent.match(/^\.PHONY:\s*(.+)$/m)
  if (!phonyMatch) {
    process.stderr.write(
      'check-local-ci-parity: ERROR — Makefile present but has no .PHONY declaration ' +
        '(template regression or manual corruption). Re-run arbiter update to regenerate.\n',
    )
    return 2
  }
  const makeTargets = new Set(
    phonyMatch[1]
      .trim()
      .split(/\s+/)
      .filter((t) => !STATIC_PARITY_EXCLUDE.has(t)),
  )

  const wfJobs = new Set()
  for (const wfFile of wfFiles) {
    const content = readFileSync(join(wfDir, wfFile), 'utf-8')
    for (const job of parseWorkflowJobNames(content)) wfJobs.add(job)
  }

  const makeOnly = [...makeTargets].filter((t) => !wfJobs.has(t))

  if (makeOnly.length > 0) {
    process.stderr.write('check-local-ci-parity: FAIL — static Makefile↔workflow drift\n')
    process.stderr.write('  Makefile targets not in any workflow job:\n')
    for (const t of makeOnly.sort()) {
      process.stderr.write(`    ${t}\n`)
    }
    process.stderr.write(
      '  Fix: add matching jobs to .github/workflows/ or add to STATIC_PARITY_EXCLUDE.\n',
    )
    return 1
  }

  process.stdout.write('check-local-ci-parity: static parity OK\n')
  return 0
}

if (process.env.PARITY_STATIC_CHECK_ONLY === '1') {
  process.exit(checkStaticParity(ROOT))
}

// ─── Check-level parity check (#1225, INV-59 extension) ───────────────────────
// CI_COVERAGE: maps check-all check IDs to CI job names. After gate-full ships,
// all non-skip checks map to 'gate-full' which runs check-all L2 end-to-end.
// NOTE: CI_COVERAGE maps checks to 'gate-full' but does NOT verify each check
// individually passes in CI — actual protection comes from gate-full running L2.
const CI_COVERAGE = new Map([
  ['typecheck', 'gate'],
  ['format', 'gate'],
  ['lint', 'gate'],
  ['audit', 'gate'],
  ['consumer audit', 'gate-full'],
  ['acceptance anchor (INV-138)', 'gate-full'],
  ['unit tests', 'unit-tests'],
  ['PII scan', 'security-early-fail'],
  ['circular deps', 'debt-gates'],
  ['dead code', 'debt-gates'],
  ['coverage', 'debt-gates'],
  ['coverage ratchet (#1483)', 'debt-gates'],
  ['gitleaks', 'security-early-fail'],
  ['debt ratchet', 'gate-full'],
  ['integration suite (INV-25)', 'integration-tests'],
  ['BDD suite (INV-25)', 'gate-full'],
  ['todo max-age', 'gate-full'],
  ['codex parity (#1966)', 'gate-full'],
  ['codex self-parity (#1966)', 'gate-full'],
  ['build-kit', 'gate-full'],
  ['no redacted tokens', 'gate-full'],
  ['no work refs', 'gate-full'],
  ['private paths ignored', 'gate-full'],
  ['no tracked artifacts (INV-117)', 'gate-full'],
  // #2159: found unwired by check-unwired-guards.mjs's own self-run.
  ['hook routing (#2129)', 'gate-full'],
  ['safety adopt ratchet (#2291)', 'gate-full'],
  ['greenfield smoke', 'gate-full'],
  ['placeholders', 'gate-full'],
  ['i18n raw strings', 'gate-full'],
  ['spdx headers', 'gate-full'],
  ['orphan TODOs', 'gate-full'],
  ['no direct-fs outside the façade', 'gate-full'],
  ['inline suppressions', 'gate-full'],
  ['suppressions expiry', 'gate-full'],
  ['commitlint', 'gate-full'],
  ['test naming', 'gate-full'],
  ['hardness inventory', 'gate-full'],
  ['hardness inventory (self hooks)', 'gate-full'],
  ['docs', 'gate-full'],
  ['matrix fixtures', 'gate-full'],
  ['matrix proven cells', 'gate-full'],
  ['skills-matrix-schema', 'gate-full'],
  ['tabletop evidence (#2429)', 'gate-full'],
  ['template tests', 'gate-full'],
  ['generator tests', 'gate-full'],
  ['command tests', 'gate-full'],
  ['brownfield tests (CANON-11)', 'gate-full'],
  ['catalog parity', 'gate-full'],
  ['global-invariants parity', 'gate-full'],
  ['kit catalog parity', 'gate-full'],
  ['enforcement wired', 'gate-full'],
  // The ontology gates (INV-140/141/143). All three are L1 and therefore inside the L2 run that
  // gate-full performs end-to-end; none needs a job of its own.
  ['id registry (INV-140)', 'gate-full'],
  ['ontology wired (INV-141)', 'gate-full'],
  ['arc42 slots (INV-144)', 'gate-full'],
  ['forma schema contract (INV-143)', 'gate-full'],
  ['constraint scan (INV-115)', 'gate-full'],
  ['agent-dispatch matrix (#1267)', 'gate-full'],
  ['node version ssot', 'gate-full'],
  ['bloat ratchet', 'gate-full'],
  ['gold-audit no-regress (#1373)', 'gate-full'],
  ['gold-audit false-gap (#1373)', 'gate-full'],
  ['gold registries no-false-gap (#1413)', 'gate-full'],
  ['exit code contract', 'gate-full'],
  ['pipe/tee hazard', 'gate-full'],
  ['ssot core', 'gate-full'],
  ['doc links', 'gate-full'],
  ['doc path citations (#2243)', 'gate-full'],
  ['governance mirror sync (#1805)', 'gate-full'],
  ['doc style', 'gate-full'],
  ['orchestration integrity (#2387)', 'gate-full'],
  ['claude-md lint (#1266)', 'gate-full'],
  ['doc index (#1102)', 'gate-full'],
  ['llms.txt drift (#1721)', 'gate-full'],
  ['status dashboard', 'gate-full'],
  ['gap register', 'gate-full'],
  ['ssot core index (#1100)', 'gate-full'],
  ['adr index (INV-107)', 'gate-full'],
  ['adr digest (INV-107)', 'gate-full'],
  ['adr enforcement linkage (#1473)', 'gate-full'],
  ['cli ref parity (INV-111)', 'gate-full'],
  ['phase doc consistency (INV-113)', 'gate-full'],
  ['canonical paths', 'gate-full'],
  ['canon references', 'gate-full'],
  ['canon enforcement parity (B1)', 'gate-full'],
  ['plugin api stability', 'gate-full'],
  ['deprecations', 'gate-full'],
  ['hook contracts', 'gate-full'],
  ['api snapshot', 'gate-full'],
  ['ci tiers (INV-73)', 'gate-full'],
  ['action pin parity', 'gate-full'],
  ['action pin sha (INV-76)', 'gate-full'],
  ['runtime dep pins (#1557)', 'gate-full'],
  ['npm-ci drift (#1684)', 'gate-full'],
  ['workflow hardening (INV-76/95)', 'gate-full'],
  ['doc-set presence', 'gate-full'],
  ['anti-drift: suppression rationale', 'gate-full'],
  ['anti-drift: suppression expiry', 'gate-full'],
  ['anti-drift: pii scan config', 'gate-full'],
  ['anti-drift: secret scan', 'gate-full'],
  ['anti-drift: drift manifest', 'gate-full'],
  ['anti-drift: workflow runners', 'gate-full'],
  ['anti-drift: workflow docs sync', 'gate-full'],
  ['anti-drift: workflow integrity', 'gate-full'],
  ['anti-drift: workflow parallelism (INV-120)', 'gate-full'],
  ['anti-drift: pr size gate', 'gate-full'],
  ['anti-drift: validator helptext', 'gate-full'],
  ['anti-drift: tier coverage', 'gate-full'],
  ['anti-drift: unwired guards (#2159)', 'gate-full'],
  ['anti-drift: docker action runner safety (#1756)', 'gate-full'],
  ['nightly freshness (INV-93)', 'gate-full'],
  ['monthly freshness (INV-82)', 'gate-full'],
  ['deploy cosign supply-chain (INV-95/97/98)', 'gate-full'],
  ['no passWithNoTests (INV-25)', 'gate-full'],
  ['collab mode wired (INV-100)', 'gate-full'],
  ['merge method ff-only (INV-101)', 'gate-full'],
  ['settings coverage (#1121)', 'gate-full'],
  ['methodology coverage (#2039)', 'gate-full'],
  // F2 ceremony gates (#1838): all run inside check-all L1, so gate-full covers them.
  ['hook doc parity (CANON-10, #1838)', 'gate-full'],
  ['phantom command scan (INV-111 ext, #1838)', 'gate-full'],
  ['version parity (#1838)', 'gate-full'],
  ['derived pages (#1838)', 'gate-full'],
  ['feature matrix (INV-112)', 'gate-full'],
  ['anti-proforma (INV-118)', 'gate-full'],
  ['anti-fake-green (#1412)', 'gate-full'],
  ['fixture isolation (INV-139)', 'gate-full'],
  ['test pyramid (INV-124)', 'gate-full'],
  ['test scope-tier (INV-124)', 'gate-full'],
  ['domain-api surface (INV-125)', 'gate-full'],
  ['api e2e (INV-126)', 'gate-full'],
  ['render smoke presence (INV-127)', 'gate-full'],
  ['workflow cache strategy (§17.5 rec 3)', 'gate-full'],
  ['build-cache strategy (C3)', 'gate-full'],
  ['commit-footer rationale (INV-119)', 'gate-full'],
  // 'docs:build' is invoked via the docsCheck() warn-helper (not run[Tool]Check),
  // so the parity regex never extracts it — no CI_COVERAGE entry is required.
  ['duplication', 'gate-full'],
  ['skill provenance (#2428)', 'gate-full'],
  ['dogfood', 'gate-full'],
  ['canon-01 declination (#1922)', 'gate-full'],
  ['canon-15 wired gate (#1923)', 'gate-full'],
  ['examples drift (#2222)', 'gate-full'],
  ['emitted markdown refs (#2415)', 'gate-full'],
  ['emission coherence (INV-123)', 'gate-full'],
  ['STRIDE/RACI traceability', 'gate-full'],
  ['tdd-evidence', 'gate-full'],
  ['evidence-bundle', 'gate-full'],
  ['fail-closed audit (INV-96)', 'gate-full'],
  ['script cohesion (INV-94)', 'gate-full'],
  // actionlint runs INSIDE gate-full (the job installs it; check-all L2 runs it
  // via runToolCheck, which FAILs-in-CI on a missing binary). So it has a real
  // CI counterpart and belongs in CI_COVERAGE, not CI_SKIP_SET.
  ['actionlint', 'gate-full'],
  ['ci tool parity', 'gate-full'],
  ['perm-test guards', 'gate-full'],
  ['install command (B1)', 'gate-full'],
  ['third-party licenses', 'gate-full'],
  ['tool claims', 'gate-full'],
  ['smoke journeys (INV-137)', 'gate-full'],
  ['M16 handoff-contract marker (#2103)', 'gate-full'],
  ['e2e escalation ladder (#2043)', 'gate-full'],
])

// CI_SKIP_SET: checks intentionally excluded from CI parity enforcement.
const CI_SKIP_SET = new Set([
  'local-ci parity', // self-referential: cannot run inside gate-full
  'self-validation drill', // local-only toolchain health check
  'id stability', // binary-stability check, neutral-skips in CI (no origin/main at depth)
  'anti-telemetry', // local env variable audit — CI env differs intentionally
  'wiki lint (INV-116)', // wiki/ is generated and committed; bootstrap mode exits 0 in CI
  'conformance', // advisory (#1397/C5): guarded by existsSync('scripts/conformance.mjs') — skipped when absent
])

// Reverse of the forward check-level parity below (#2042): every CI_COVERAGE
// job-name value must correspond to a real, current job in
// .github/workflows/*.yml. Without this, a job rename/removal silently
// desyncs the map without failing the gate. Neutral-skip (0, no output) when
// no workflow files are present — mirrors the static check's skip behavior.
function checkCoverageJobsAreReal(root) {
  const wfJobs = readWorkflowJobNames(root)
  if (wfJobs === null) return 0

  const staleJobs = [...new Set(CI_COVERAGE.values())].filter((job) => !wfJobs.has(job))
  if (staleJobs.length === 0) return 0

  process.stderr.write('check-local-ci-parity: FAIL — check-level parity drift (reverse)\n')
  process.stderr.write('  CI_COVERAGE job names with no matching workflow job (stale/renamed):\n')
  for (const job of staleJobs.sort()) {
    process.stderr.write(`    "${job}"\n`)
  }
  process.stderr.write(
    '  Fix: update CI_COVERAGE to the current job name, or restore/rename the workflow job.\n',
  )
  return 1
}

function checkLevelParity(root) {
  const checkAllPath = join(root, 'scripts', 'check-all.mjs')
  if (!existsSync(checkAllPath)) {
    process.stdout.write(
      '[skip] check-level parity: scripts/check-all.mjs absent — skipping check-level check\n',
    )
    return 0
  }

  const src = readFileSync(checkAllPath, 'utf-8')
  const ids = new Set()
  for (const m of src.matchAll(/run(?:Tool)?Check\s*\(\s*['"]([^'"]+)['"]/g)) {
    ids.add(m[1])
  }

  const uncovered = []
  for (const id of ids) {
    if (!CI_COVERAGE.has(id) && !CI_SKIP_SET.has(id)) {
      uncovered.push(id)
    }
  }

  if (uncovered.length > 0) {
    process.stderr.write('check-local-ci-parity: FAIL — check-level parity drift\n')
    process.stderr.write('  Checks with no CI counterpart (not in CI_COVERAGE or CI_SKIP_SET):\n')
    for (const id of uncovered.sort()) {
      process.stderr.write(`    "${id}"\n`)
    }
    process.stderr.write(
      '  Fix: add to CI_COVERAGE (map to gate-full or a CI job) or CI_SKIP_SET (document why).\n',
    )
    return 1
  }

  const reverseCode = checkCoverageJobsAreReal(root)
  if (reverseCode !== 0) {
    return reverseCode
  }

  process.stdout.write(
    `check-local-ci-parity: check-level parity OK (${ids.size} checks verified)\n`,
  )
  return 0
}

if (process.env.PARITY_CHECK_LEVEL_ONLY === '1') {
  process.exit(checkLevelParity(ROOT))
}

// Run static check unconditionally — does not require a prior L2 run.
const staticCode = checkStaticParity(ROOT)
if (staticCode !== 0) {
  process.exit(staticCode)
}

// Run check-level parity BEFORE the local-result guard (RT-06: must not be dead
// code in CI). In a clean CI checkout there is no local-result.json, so placing
// this after the guard would skip it — defeating the purpose. It runs every time.
const checkLevelCode = checkLevelParity(ROOT)
if (checkLevelCode !== 0) {
  process.exit(checkLevelCode)
}

const LOCAL_RESULT_PATH = join(ROOT, '.arbiter', 'gate', 'local-result.json')

function skip(reason) {
  process.stdout.write(`check-local-ci-parity: ${reason}\n`)
  process.stdout.write('check-local-ci-parity: SKIP (neutral)\n')
  // #2052: recognized marker so runCheck surfaces SKIP, not PASS, in the gate summary.
  process.stdout.write(`[SKIP] ${reason}\n`)
  process.exit(0)
}

// ─── Read local result ─────────────────────────────────────────────────────────
if (!existsSync(LOCAL_RESULT_PATH)) {
  skip('no local gate result — run `node scripts/check-all.mjs L2` first')
}

let localResult
try {
  localResult = JSON.parse(readFileSync(LOCAL_RESULT_PATH, 'utf-8'))
} catch (err) {
  process.stderr.write(`check-local-ci-parity: cannot parse ${LOCAL_RESULT_PATH}: ${err.message}\n`)
  process.exit(2)
}

if (localResult.schema !== 'arbiter-gate-v1') {
  process.stderr.write(
    `check-local-ci-parity: unexpected schema '${localResult.schema}' — re-run check-all.mjs\n`,
  )
  process.exit(2)
}

// ─── Fetch CI artifact via gh CLI ─────────────────────────────────────────────
const ghCheck = spawnSync('gh', ['--version'], {
  encoding: 'utf-8',
  shell: false,
})
if (ghCheck.error || ghCheck.status !== 0) {
  skip('gh CLI not available — skipping CI artifact fetch')
}

const branchOut = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  encoding: 'utf-8',
  shell: false,
})
if (branchOut.error || branchOut.status !== 0) {
  skip('could not determine current branch')
}
const branch = branchOut.stdout.trim()

const runsOut = spawnSync(
  'gh',
  [
    'run',
    'list',
    '--branch',
    branch,
    '--status',
    'completed',
    '--limit',
    '1',
    '--json',
    'databaseId,headSha',
  ],
  { encoding: 'utf-8', shell: false },
)

let runs
try {
  runs = JSON.parse(runsOut.stdout ?? '[]')
} catch {
  runs = []
}
if (runsOut.status !== 0 || !Array.isArray(runs) || runs.length === 0) {
  skip('no completed CI run found for this branch')
}
const latestRunId = String(runs[0].databaseId)
const ciHeadSha = runs[0].headSha

// The "latest completed CI run for this branch" is not necessarily for the
// current local HEAD — if local commits were made after that run started
// (e.g. a just-applied fix that hasn't been pushed yet), the fetched CI
// artifact reflects an older, unrelated commit. Comparing against it would
// report false "drift" for gates the fix already corrected locally. Treat
// a headSha mismatch as neutral (not yet verified by CI), matching the
// existing stale-artifact handling below (#1602).
const localHeadOut = spawnSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf-8',
  shell: false,
})
const localHeadSha = (localHeadOut.stdout ?? '').trim()
if (localHeadOut.status === 0 && localHeadSha && ciHeadSha && ciHeadSha !== localHeadSha) {
  skip(
    `latest completed CI run is for commit ${ciHeadSha.slice(0, 12)}, but local HEAD is ` +
      `${localHeadSha.slice(0, 12)} — not yet verified by CI (push and re-check after CI completes)`,
  )
}

// Download artifact to a temp dir; clean up regardless of outcome
const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-parity-'))

function cleanupAndSkip(reason) {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
  skip(reason)
}

const dlResult = spawnSync(
  'gh',
  ['run', 'download', latestRunId, '--name', 'gate-result', '--dir', tmpDir],
  { encoding: 'utf-8', shell: false },
)

if (dlResult.status !== 0) {
  cleanupAndSkip('gate-result artifact not found in CI run')
}

const ciResultPath = join(tmpDir, 'gate-result.json')
if (!existsSync(ciResultPath)) {
  cleanupAndSkip('gate-result.json not in downloaded artifact')
}

let ciResult
try {
  ciResult = JSON.parse(readFileSync(ciResultPath, 'utf-8'))
} catch (err) {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
  process.stderr.write(`check-local-ci-parity: cannot parse CI gate result: ${err.message}\n`)
  process.exit(2)
}

try {
  rmSync(tmpDir, { recursive: true, force: true })
} catch {
  // ignore cleanup errors
}

// ─── Compare parity hashes ─────────────────────────────────────────────────────
if (!localResult.parityContentHash || !ciResult.parityContentHash) {
  skip('gate result missing parityContentHash — regenerate with check-all.mjs L2')
}

if (localResult.parityContentHash === ciResult.parityContentHash) {
  process.stdout.write(
    `check-local-ci-parity: OK (hash ${localResult.parityContentHash.slice(0, 12)}…)\n`,
  )
  process.exit(0)
}

// Hashes differ. Distinguish a real behavioural drift from a stale-CI-artifact
// set-membership difference (#1602). A gate present on only ONE side (absent in the other)
// means the gate SET changed between the last CI run and now — e.g. a new gate added to
// check-all.mjs that the pre-existing CI artifact predates; CI runs the same check-all.mjs
// and will include it on its next run. That is NOT a result drift. Only a gate present in
// BOTH sides with a DIFFERENT pass value is a real local↔CI drift that must block the push.
const localMap = new Map((localResult.parityGates ?? []).map((g) => [g.name, g.pass]))
const ciMap = new Map((ciResult.parityGates ?? []).map((g) => [g.name, g.pass]))

const allNames = new Set([...localMap.keys(), ...ciMap.keys()])
const diffs = []
for (const name of [...allNames].sort()) {
  const lv = localMap.get(name)
  const cv = ciMap.get(name)
  if (lv !== cv) {
    diffs.push({ name, local: lv, ci: cv })
  }
}

const fmt = (v) => (v === undefined ? 'absent' : v ? 'PASS' : 'FAIL')
const realDrifts = diffs.filter((d) => d.local !== undefined && d.ci !== undefined)
const staleOnly = diffs.filter((d) => d.local === undefined || d.ci === undefined)

if (realDrifts.length === 0) {
  // Only set-membership differences → stale CI artifact, not a behavioural drift. Neutral.
  process.stdout.write(
    'check-local-ci-parity: hash differs only by gate-set membership ' +
      `(stale CI artifact; ${staleOnly.length} gate(s) present on one side only) — no result drift. Neutral.\n`,
  )
  for (const d of staleOnly) {
    process.stdout.write(`    ${d.name}: local=${fmt(d.local)}, ci=${fmt(d.ci)}\n`)
  }
  process.exit(0)
}

process.stderr.write('check-local-ci-parity: FAIL — local↔CI parity drift detected\n\n')
process.stderr.write(`  local:  ${localResult.parityContentHash}\n`)
process.stderr.write(`  ci:     ${ciResult.parityContentHash}\n\n`)
process.stderr.write('  Differing gates (result drift):\n')
for (const d of realDrifts) {
  process.stderr.write(`    ${d.name}: local=${fmt(d.local)}, ci=${fmt(d.ci)}\n`)
}
process.stderr.write('\n  Fix: resolve the differing gates locally and in CI, then re-run.\n\n')
process.exit(1)
