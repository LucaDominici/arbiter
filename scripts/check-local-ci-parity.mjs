#!/usr/bin/env node
// check-local-ci-parity.mjs — local↔CI gate result parity check (INV-59, #470)
//
// Reads .arbiter/gate/local-result.json and the latest CI gate-result artifact.
// Compares parityContentHash. On mismatch, prints a diff and exits 1.
//
// Exit codes:
//   0 — hashes match, or no CI artifact available (neutral skip)
//   1 — hash mismatch (parity drift detected)
//   2 — invocation error (parse failure, bad artifact schema)
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const LOCAL_RESULT_PATH = join(ROOT, '.arbiter', 'gate', 'local-result.json')

function skip(reason) {
  process.stdout.write(`check-local-ci-parity: ${reason}\n`)
  process.stdout.write('check-local-ci-parity: SKIP (neutral)\n')
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
    'databaseId',
    '--jq',
    '.[0].databaseId',
  ],
  { encoding: 'utf-8', shell: false },
)

const runIdRaw = (runsOut.stdout ?? '').trim()
if (runsOut.status !== 0 || !runIdRaw || runIdRaw === 'null') {
  skip('no completed CI run found for this branch')
}
const latestRunId = runIdRaw

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

// Hashes differ — report drift
process.stderr.write('check-local-ci-parity: FAIL — local↔CI parity drift detected\n\n')
process.stderr.write(`  local:  ${localResult.parityContentHash}\n`)
process.stderr.write(`  ci:     ${ciResult.parityContentHash}\n\n`)

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

if (diffs.length > 0) {
  process.stderr.write('  Differing gates:\n')
  for (const d of diffs) {
    const lStr = d.local === undefined ? 'absent' : d.local ? 'PASS' : 'FAIL'
    const cStr = d.ci === undefined ? 'absent' : d.ci ? 'PASS' : 'FAIL'
    process.stderr.write(`    ${d.name}: local=${lStr}, ci=${cStr}\n`)
  }
  process.stderr.write('\n')
}

process.stderr.write('  Fix: resolve the differing gates locally and in CI, then re-run.\n\n')
process.exit(1)
