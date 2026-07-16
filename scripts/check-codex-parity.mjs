#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: ADR-106 / #1966 enforcement — codex-track parity contract. Bakes a pinned
// CATALOG:   fixture project with BOTH tracks via the real CLI (`init`), scans the track
// CATALOG:   roots (independent denominator), classifies every emitted file into exactly one
// CATALOG:   parity class (DERIVED / ALLOWLISTED / BY-DESIGN-EXCLUSIVE), verifies derived
// CATALOG:   files against the canonical Claude source AND committed goldens, validates the
// CATALOG:   generated CODEX.md Known Limitations table against the actual hook inventory,
// CATALOG:   and ratchets per-track file identities against a merge-base baseline.
// CATALOG: Rejected fold-in into check-self-dogfood.mjs — that gate proves template ↔
// CATALOG:   materialized .claude/ identity for THIS repo's own dogfooding; this gate proves
// CATALOG:   cross-TRACK (claude ↔ codex) parity of generated output for any target. Different
// CATALOG:   axis (dogfood self-identity vs product track parity), different fixture surface.
//
// Usage:
//   node scripts/check-codex-parity.mjs                 # full run (bake + all checks)
//   node scripts/check-codex-parity.mjs --baked-dir <d> # test-only: skip bake, use a
//                                                       #   pre-baked tree (fixtures)
//   node scripts/check-codex-parity.mjs --update-baseline  # reseed the committed baseline
//   node scripts/check-codex-parity.mjs --help
//
// Exit codes (INV-53): 0=PASS, 1=FAIL (parity violation), 2=ERROR (config/environment,
// fail-closed — e.g. merge-base unresolvable in a shallow clone; see hardening 17).
//
// Runbook: docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md
// Operator entry: website/problems/codex-parity.md
//
// Exports for unit tests: bakeFixtureProject, resolveMergeBaseBaseline,
// checkGoldenEvolution, cleanChildEnv

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runParityCheck, scanTrackRoots, readJsonIfExists } from './lib/codex-parity-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const DATA_DIR = join(repoRoot, 'scripts', 'data')
const GOLDENS_DIR = join(repoRoot, '__tests__', 'fixtures', 'codex-parity', 'golden')
const BASELINE_REPO_PATH = 'scripts/data/codex-parity-baseline.json'
const GOLDENS_REPO_PREFIX = '__tests__/fixtures/codex-parity/golden/'
const CANONICAL_REPO_PREFIX = 'src/templates/claude/'

const HELP = `Usage: node scripts/check-codex-parity.mjs [options]

Codex-track parity contract gate (ADR-106, #1966).

Options:
  --baked-dir <dir>   Use a pre-baked project tree instead of baking (tests only)
  --update-baseline   Rewrite scripts/data/codex-parity-baseline.json from the current bake
  --help, -h          Show this help and exit

Exit codes: 0=PASS, 1=FAIL, 2=ERROR (fail-closed).
`

function parseArgs(argv) {
  const args = { bakedDir: undefined, updateBaseline: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--update-baseline') args.updateBaseline = true
    else if (a === '--baked-dir') args.bakedDir = argv[++i]
    else {
      process.stderr.write(`check-codex-parity: unknown argument ${a}\n${HELP}`)
      process.exit(2)
    }
  }
  return args
}

/**
 * Child-process environment for every spawn: explicit, with all ARBITER_*
 * variables stripped so an outer task/gate context can never leak into the
 * bake or the git queries (fixture concurrency hardening 10, F1 lesson).
 */
export function cleanChildEnv(base = process.env) {
  return Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith('ARBITER_')))
}

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    encoding: 'utf-8',
    env: cleanChildEnv(),
    // Capture stderr instead of inheriting it: expected-failure probes (e.g.
    // `git show` on a merge-base without the baseline → BOOTSTRAP) must not
    // leak scary fatal lines into the gate output.
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
}

/**
 * Bake the pinned fixture project (TypeScript, L2, tools claude+codex) into a
 * unique tmpdir via the REAL CLI — the same `init` path users run, so the
 * scanned surface is the actual product emission, not a partial re-render.
 * Returns the project dir; caller removes it in `finally`.
 */
export function bakeFixtureProject() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-parity-bake-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'parity-fixture', version: '0.1.0', private: true }, null, 2),
  )
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const parityFixture = true\n')
  run('git', ['init', '-q'], { cwd: dir })
  run('git', ['config', 'user.email', 'parity@fixture.local'], { cwd: dir })
  run('git', ['config', 'user.name', 'Parity Fixture'], { cwd: dir })

  const tsxBin = join(repoRoot, 'node_modules', '.bin', 'tsx')
  const cliSrc = join(repoRoot, 'src', 'cli.ts')
  run(
    tsxBin,
    [
      cliSrc,
      'init',
      '--yes',
      '--tools',
      'claude,codex',
      '--level',
      'L2',
      '--dir',
      dir,
      '--no-verify',
      '--quiet',
    ],
    { cwd: repoRoot, timeout: 300_000 },
  )
  return dir
}

/**
 * Resolve the baseline as of `git merge-base origin/main HEAD` (hardening 14:
 * anti-self-consistency — the working-tree baseline can be edited in the same
 * change that shrinks the surface; the merge-base copy cannot). Fails CLOSED
 * (exit 2) when the merge-base is unresolvable (hardening 17); a repo where
 * the baseline did not exist yet at merge-base is the documented BOOTSTRAP
 * case, not an error.
 */
export function resolveMergeBaseBaseline(gitRun = run) {
  let mergeBase
  try {
    mergeBase = gitRun('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: repoRoot }).trim()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      error:
        `cannot resolve 'git merge-base origin/main HEAD' (${detail.split('\n')[0]}). ` +
        `This gate fails closed: fetch full history first (CI: actions/checkout with ` +
        `fetch-depth: 0; locally: git fetch origin main).`,
    }
  }
  let raw
  try {
    raw = gitRun('git', ['show', `${mergeBase}:${BASELINE_REPO_PATH}`], { cwd: repoRoot })
  } catch {
    return { mergeBase, baseline: 'BOOTSTRAP' }
  }
  try {
    return { mergeBase, baseline: JSON.parse(raw) }
  } catch {
    return { error: `baseline at merge-base ${mergeBase} is not valid JSON — fail closed` }
  }
}

/**
 * Golden evolution heuristic (hardening 15): a diff that MODIFIES committed
 * goldens without touching the canonical Claude templates is a blind golden
 * rewrite — refused. Legitimate evolution changes both in the same branch
 * (see the runbook's golden evolution protocol). Newly ADDED goldens are the
 * bootstrap/extension case (a new derived pair) and are judged by the
 * golden-vs-generated comparison instead.
 */
export function checkGoldenEvolution(modifiedFiles, allChangedFiles) {
  const goldenChanged = modifiedFiles.some((f) => f.startsWith(GOLDENS_REPO_PREFIX))
  const canonicalChanged = allChangedFiles.some((f) => f.startsWith(CANONICAL_REPO_PREFIX))
  if (goldenChanged && !canonicalChanged) {
    return [
      {
        kind: 'golden-unjustified',
        file: GOLDENS_REPO_PREFIX,
        message:
          'goldens changed in this branch without any src/templates/claude/ change — ' +
          'goldens evolve only together with their canonical source (runbook: golden ' +
          'evolution protocol)',
      },
    ]
  }
  return []
}

function gitDiffNames(mergeBase, extraArgs = []) {
  return run('git', ['diff', '--name-only', ...extraArgs, `${mergeBase}..HEAD`], { cwd: repoRoot })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function loadDataFile(name) {
  const data = readJsonIfExists(join(DATA_DIR, name))
  if (data === undefined) {
    process.stderr.write(`check-codex-parity: missing data file scripts/data/${name}\n`)
    process.exit(2)
  }
  return data
}

function readManifestFiles(bakedDir) {
  const manifest = readJsonIfExists(join(bakedDir, '.arbiter-generated-manifest.json'))
  return manifest === undefined ? undefined : Object.keys(manifest.files ?? {})
}

function updateBaseline(scan, committed) {
  const next = {
    $schemaVersion: 1,
    fixture: 'init --yes --tools claude,codex --level L2 (TypeScript scaffold)',
    tracks: {
      claude: { files: scan.claude },
      codex: { files: scan.codex },
    },
    removals: committed?.removals ?? [],
  }
  writeFileSync(join(DATA_DIR, 'codex-parity-baseline.json'), JSON.stringify(next, null, 2) + '\n')
  process.stdout.write(
    `check-codex-parity: baseline updated (claude=${scan.claude.length}, codex=${scan.codex.length} files)\n`,
  )
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    process.exit(0)
  }

  const allowlist = loadDataFile('codex-parity-allowlist.json')
  const exclusive = loadDataFile('codex-parity-exclusive.json')
  const baseline = loadDataFile('codex-parity-baseline.json')

  const mb = resolveMergeBaseBaseline()
  if (mb.error !== undefined) {
    process.stderr.write(`check-codex-parity: ERROR — ${mb.error}\n`)
    process.exit(2)
  }

  const isEphemeralBake = args.bakedDir === undefined
  const bakedDir = args.bakedDir ?? bakeFixtureProject()
  try {
    if (args.updateBaseline) {
      updateBaseline(scanTrackRoots(bakedDir, exclusive.scanExclusions ?? []), baseline)
      process.exit(0)
    }

    let findings
    try {
      findings = checkGoldenEvolution(
        gitDiffNames(mb.mergeBase, ['--diff-filter=M']),
        gitDiffNames(mb.mergeBase),
      )
    } catch (err) {
      const detail = err instanceof Error ? err.message.split('\n')[0] : String(err)
      process.stderr.write(`check-codex-parity: ERROR — git diff vs merge-base failed: ${detail}\n`)
      process.exit(2)
    }
    const manifestFiles = readManifestFiles(bakedDir)
    if (manifestFiles === undefined && isEphemeralBake) {
      process.stderr.write('check-codex-parity: ERROR — bake produced no generated manifest\n')
      process.exit(2)
    }

    const result = runParityCheck({
      bakedDir,
      // A --baked-dir fixture without a manifest (tests) reconciles against
      // its own scan; the real gate path always has the init-written manifest.
      manifestFiles: manifestFiles ?? selfManifest(bakedDir, exclusive),
      allowlist,
      exclusive,
      baseline,
      mergeBaseBaseline: mb.baseline,
      goldensDir: GOLDENS_DIR,
    })
    result.findings.push(...findings)

    report(result)
    process.exit(result.findings.length === 0 ? 0 : 1)
  } finally {
    if (isEphemeralBake) rmSync(bakedDir, { recursive: true, force: true })
  }
}

function selfManifest(bakedDir, exclusive) {
  const scan = scanTrackRoots(bakedDir, exclusive.scanExclusions ?? [])
  return [...scan.claude, ...scan.codex]
}

function report(result) {
  for (const f of result.findings) {
    process.stdout.write(`  [${f.kind}] ${f.file}: ${f.message}\n`)
  }
  const { total, classified } = result.surface
  const pct = total === 0 ? 0 : Math.round((classified / total) * 100)
  process.stdout.write(`check-codex-parity: parity-surface: ${classified}/${total} (${pct}%)\n`)
  process.stdout.write(
    result.findings.length === 0
      ? 'check-codex-parity: OK\n'
      : `check-codex-parity: FAIL — ${result.findings.length} finding(s); see ` +
          `website/problems/codex-parity.md for the failure playbook\n`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
