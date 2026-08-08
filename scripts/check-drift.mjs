#!/usr/bin/env node
// arbiter — generated content drift detector (INV-89)
// Validates that committed generated files match what the generator would produce.
// Uses a manifest of generated files with expected content hashes.
// Exits 0 when no drift found; exits 1 when generated content has drifted.
// Part of the anti-drift validator family (W6).
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)

// #2044 (AC-2044.5/6): live-SSOT binding — a commit that touches CODE must also
// update every declared-live SSOT surface (matrix/ledger) in the SAME commit.
// The obligation is LIMITED to the surfaces declared in .arbiter/live-ssot.json
// (never every commit); the manifest absent => SKIP. The binding inspects the
// LAST commit (HEAD vs HEAD^): CI runs the gate against the branch head.
function runLiveSsotBinding() {
  const LIVE_MANIFEST = join(CWD, '.arbiter', 'live-ssot.json')
  if (!existsSync(LIVE_MANIFEST)) {
    process.stdout.write('[SKIP] no .arbiter/live-ssot.json — no declared-live SSOT surfaces\n')
    return true
  }
  let declaration
  try {
    declaration = JSON.parse(readFileSync(LIVE_MANIFEST, 'utf-8'))
  } catch (err) {
    process.stderr.write(`check-drift: FAIL — invalid JSON in ${LIVE_MANIFEST}: ${err.message}\n`)
    return false
  }
  const surfaces = Array.isArray(declaration?.surfaces) ? declaration.surfaces : []
  if (surfaces.length === 0) {
    process.stderr.write(`check-drift: FAIL — ${LIVE_MANIFEST} declares no surfaces\n`)
    return false
  }
  const git = spawnSync('git', ['rev-parse', '--verify', 'HEAD^'], { cwd: CWD, encoding: 'utf-8' })
  if (git.status !== 0) {
    // Initial commit (no parent) — nothing to bind yet.
    process.stdout.write('[SKIP] no parent commit — live-SSOT binding needs a commit range\n')
    return true
  }
  const changed = spawnSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], {
    cwd: CWD,
    encoding: 'utf-8',
  })
  const changedFiles = (changed.stdout ?? '').split('\n').filter((l) => l.trim() !== '')
  const surfacePaths = surfaces.map((s) => s?.path).filter((p) => typeof p === 'string')
  const touchedSurfaces = changedFiles.filter((f) => surfacePaths.includes(f))
  // Code = any changed path that is not a doc, not the drift/live manifests,
  // not a declared surface, not a workflow/generated artifact.
  const codeFiles = changedFiles.filter(
    (f) =>
      !f.startsWith('docs/') &&
      !f.endsWith('.md') &&
      !f.startsWith('.arbiter/') &&
      !f.startsWith('.github/') &&
      !surfacePaths.includes(f),
  )
  if (codeFiles.length === 0) {
    process.stdout.write('check-drift: live-SSOT binding — no code files in the last commit\n')
    return true
  }
  if (touchedSurfaces.length === 0) {
    process.stderr.write(
      `check-drift: FAIL — live-SSOT binding: code changed without updating the declared-live surface(s):\n`,
    )
    for (const s of surfacePaths) process.stderr.write(`  - ${s}\n`)
    process.stderr.write(
      `  code files in commit: ${codeFiles.join(', ')}\n` +
        '  Fix: update the live surface in the SAME commit (INV-63 SSOT atomic).\n',
    )
    return false
  }
  process.stdout.write(
    `check-drift: live-SSOT binding OK — ${touchedSurfaces.length} surface(s) updated in the commit\n`,
  )
  return true
}
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-drift.mjs [options]',
      '',
      'Validates that committed generated files match expected content hashes.',
      'Exits 0 when no drift found; exits 1 when generated content has drifted.',
      '',
      'Manifest format: JSON array of { path, hash, generator } entries.',
      '',
      'Options:',
      '  --manifest <path>   Path to drift manifest (default: .arbiter/drift-manifest.json)',
      '  --dir <path>        Root directory (default: cwd)',
      '  --help, -h          Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const manifestArg = args.indexOf('--manifest')
const dirArg = args.indexOf('--dir')
const CWD = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd()
const MANIFEST_PATH =
  manifestArg >= 0 && args[manifestArg + 1]
    ? resolve(args[manifestArg + 1])
    : join(CWD, '.arbiter', 'drift-manifest.json')

// #2044: live-SSOT binding runs BEFORE the hash check (independent concern);
// a binding violation exits 1 without touching the hash audit.
if (!runLiveSsotBinding()) process.exit(1)

if (!existsSync(MANIFEST_PATH)) {
  process.stdout.write(
    'check-drift: SKIP — no drift manifest found (.arbiter/drift-manifest.json)\n',
  )
  // #2052/#2012: recognized marker so runCheck surfaces SKIP, not PASS. Without it a
  // manifest-less repo reports PASS on every gate run while verifying nothing.
  process.stdout.write('[SKIP] no drift manifest found (.arbiter/drift-manifest.json)\n')
  process.exit(0)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
} catch (err) {
  if (err instanceof SyntaxError) {
    process.stderr.write(`check-drift: FAIL — invalid JSON in manifest: ${err.message}\n`)
    process.exit(1)
  }
  throw err
}

if (!Array.isArray(manifest)) {
  process.stderr.write('check-drift: FAIL — drift manifest must be a JSON array\n')
  process.exit(1)
}

let violations = 0
let checked = 0

for (const entry of manifest) {
  if (!entry || typeof entry.path !== 'string' || typeof entry.hash !== 'string') {
    process.stderr.write(`[FAIL] invalid manifest entry: ${JSON.stringify(entry)}\n`)
    violations++
    continue
  }
  const filePath = join(CWD, entry.path)
  if (!existsSync(filePath)) {
    process.stderr.write(
      `[FAIL] generated file missing: ${entry.path} (expected hash: ${entry.hash})\n`,
    )
    violations++
    continue
  }
  checked++
  const content = readFileSync(filePath, 'utf-8')
  const actual = createHash('sha256').update(content).digest('hex')
  if (actual !== entry.hash) {
    const generator = entry.generator ? ` (generator: ${entry.generator})` : ''
    process.stderr.write(
      `[FAIL] drift detected in ${entry.path}${generator}\n  expected: ${entry.hash}\n  actual:   ${actual}\n`,
    )
    violations++
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-drift: FAIL — ${violations}/${manifest.length} generated file(s) have drifted (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-drift: OK — all ${checked} generated file(s) match manifest hashes (INV-89)\n`,
)
process.exit(0)
