#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: #2428 provenance gate -- fails when an arbiter-authored SKILL.md/command shares
// CATALOG: >= OVERLAP_THRESHOLD normalized-and-hashed lines with one companion upstream skill
// CATALOG: (Superpowers, obra/superpowers). Never compares against or stores upstream TEXT --
// CATALOG: only sha256 hashes of normalized lines, committed in companion-line-hashes.json and
// CATALOG: refreshed offline-fail-closed by --refresh-hashes (gh api, network-only mode).
// CATALOG: rejected fold-in into check-duplication.mjs: that gate wraps jscpd for INTRA-repo
// CATALOG: token-level clone detection; it has no external-corpus concept and never fetches
// CATALOG: upstream content -- a different failure model and a different data source.
// CATALOG: rejected fold-in into check-skills-matrix.mjs: that gate validates the matrix JSON
// CATALOG: schema (required fields, `replaces` targets) -- it never reads SKILL.md/command
// CATALOG: bodies and has no line-content comparison of any kind.
//
// Unlike check-todo-max-age.mjs (graceful-skip offline), this gate NEVER skips: the default
// (non-refresh) invocation only ever reads the COMMITTED hash file -- no network involved, so
// there is nothing to skip. `--refresh-hashes` is the only network path, and it fails CLOSED
// (non-zero exit, clear message, no partial write) when `gh` is unavailable or the fetch fails --
// the committed hash file remains authoritative and unmodified (INV-96).
//
// Usage:
//   node scripts/check-skill-provenance.mjs
//     [--root <dir>] [--hashes <path>] [--threshold <n>]
//   node scripts/check-skill-provenance.mjs --refresh-hashes
//     [--sources <path>] [--hashes <path>] [--gh-bin <bin>]
//   node scripts/check-skill-provenance.mjs --self-test
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (overlap >= threshold, or refresh failed), 2 invocation/IO error.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { walkRepo, globMatch } from './lib/glob-walk.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const LABEL = '[check-skill-provenance]'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

export const MIN_LINE_LENGTH = 25
export const OVERLAP_THRESHOLD = 8

// Local corpus in scope (#2428 audit): arbiter's OWN authored skills/commands + their emitted
// template twins. Deliberately excludes __tests__/fixtures/skill-trees/with-superpowers* -- those
// are synthetic 8-line stubs from the audit, not authored content, and would be a false positive
// at exactly this threshold.
export const LOCAL_GLOBS = [
  '.claude/skills/*/SKILL.md',
  '.claude/commands/*.md',
  'src/templates/claude/skills/*/SKILL.md.ejs',
  'src/templates/claude/commands/*.md.ejs',
]

function parseArgs(argv) {
  const get = (name) => {
    const idx = argv.indexOf(`--${name}`)
    return idx === -1 ? undefined : argv[idx + 1]
  }
  return {
    root: resolve(get('root') ?? REPO_ROOT),
    hashesPath: resolve(
      get('hashes') ?? join(REPO_ROOT, 'scripts/data/companion-line-hashes.json'),
    ),
    sourcesPath: resolve(get('sources') ?? join(REPO_ROOT, 'scripts/data/companion-sources.json')),
    ghBin: get('gh-bin') ?? 'gh',
    threshold: get('threshold') ? Number(get('threshold')) : OVERLAP_THRESHOLD,
    refreshHashes: argv.includes('--refresh-hashes'),
    selfTest: argv.includes('--self-test'),
  }
}

// ── Pure logic (unit-tested without I/O) ──────────────────────────────────────

/** Normalize one line for comparison: trim, lowercase, drop short/non-substantive lines. */
export function normalizeLine(line) {
  const norm = String(line ?? '')
    .trim()
    .toLowerCase()
  return norm.length >= MIN_LINE_LENGTH ? norm : null
}

/** sha256 hex digest of an already-normalized line. Never stores/returns the source text. */
export function hashLine(normalized) {
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/** The set of substantive-line hashes for a file/text body. */
export function lineHashSet(content) {
  const set = new Set()
  for (const raw of String(content ?? '').split('\n')) {
    const normalized = normalizeLine(raw)
    if (normalized) set.add(hashLine(normalized))
  }
  return set
}

/** Count of hashes common to both sets. */
export function overlapCount(a, b) {
  let n = 0
  for (const h of a) if (b.has(h)) n++
  return n
}

/**
 * Every (local file, companion skill) pair with overlapCount > 0, sorted by count descending.
 * `companionHashLists` maps a companion skillId ("superpowers:tdd") -> array of hashes.
 */
export function evaluatePairs(localHashSets, companionHashLists) {
  const pairs = []
  for (const [file, hashes] of localHashSets) {
    for (const [companionId, hashList] of Object.entries(companionHashLists)) {
      const count = overlapCount(hashes, new Set(hashList))
      if (count > 0) pairs.push({ file, companionId, count })
    }
  }
  return pairs.sort((a, b) => b.count - a.count)
}

function readJson(path, what) {
  if (!existsSync(path)) {
    throw Object.assign(new Error(`missing required ${what}: ${path}`), { exitCode: 2 })
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    throw Object.assign(new Error(`malformed ${what} (${path}): ${err.message}`), { exitCode: 2 })
  }
}

/** Collect local-corpus files under `root` matching LOCAL_GLOBS, as repo-relative POSIX paths. */
function collectLocalFiles(root) {
  return walkRepo(root).filter((p) => LOCAL_GLOBS.some((glob) => globMatch(glob, p)))
}

function buildLocalHashSets(root, files) {
  const map = new Map()
  for (const rel of files) {
    const content = readFileSync(join(root, rel), 'utf-8')
    map.set(rel, lineHashSet(content))
  }
  return map
}

// ── Gate mode (reads the committed hash file only -- no network) ─────────────

function runGate({ root, hashesPath, threshold }) {
  const hashesDoc = readJson(hashesPath, 'companion-line-hashes.json')
  const companionHashLists = hashesDoc.companions ?? {}
  // Fail closed on a vacuous scan (INV-96, mirrors check-duplication.mjs's #1286 guard against a
  // 0-file jscpd run silently passing): an empty hash file or a local corpus that matched zero
  // files is NOT the same thing as "no overlap found" and must never look like a pass.
  if (Object.keys(companionHashLists).length === 0) {
    throw Object.assign(
      new Error(
        `no companion hashes in ${hashesPath} -- refusing a vacuous pass; run --refresh-hashes`,
      ),
      { exitCode: 2 },
    )
  }
  const files = collectLocalFiles(root)
  if (files.length === 0) {
    throw Object.assign(
      new Error(
        `no local skill/command files matched under ${root} -- refusing a vacuous pass (LOCAL_GLOBS drift?)`,
      ),
      { exitCode: 2 },
    )
  }
  const localHashSets = buildLocalHashSets(root, files)
  const pairs = evaluatePairs(localHashSets, companionHashLists)
  const failing = pairs.filter((p) => p.count >= threshold)

  const top = pairs.slice(0, 20)
  if (top.length > 0) {
    process.stdout.write(`${LABEL} overlap counts (top ${top.length} of ${pairs.length} pairs):\n`)
    for (const p of top) {
      const mark = p.count >= threshold ? 'FAIL' : 'ok'
      process.stdout.write(`  [${mark}] ${p.file} <-> ${p.companionId}: ${p.count}\n`)
    }
  } else {
    process.stdout.write(`${LABEL} no overlapping substantive lines observed.\n`)
  }

  if (failing.length > 0) {
    process.stderr.write(
      `${LABEL} FAIL -- ${failing.length} pair(s) share >= ${threshold} hashed lines with a companion upstream skill:\n`,
    )
    for (const p of failing) {
      process.stderr.write(`  ${p.file} shares ${p.count} lines with ${p.companionId}\n`)
    }
    return 1
  }
  process.stdout.write(
    `${LABEL} OK -- ${files.length} local files checked against ${Object.keys(companionHashLists).length} companion skills for a >= ${threshold}-line overlap ceiling.\n`,
  )
  return 0
}

// ── Refresh mode (network, fail-closed, never writes upstream text) ──────────

/** Fetch one upstream file's raw text via `gh api`, or null on any failure. */
function fetchRaw(ghBin, repo, path) {
  const result = spawnSync(
    ghBin,
    ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${path}`],
    { encoding: 'utf-8', timeout: 30000 },
  )
  if (result.error || result.status !== 0) return null
  return result.stdout
}

function runRefresh({ sourcesPath, hashesPath, ghBin }) {
  const sourcesDoc = readJson(sourcesPath, 'companion-sources.json')
  const sources = sourcesDoc.sources ?? []
  const companions = {}
  const failures = []
  for (const src of sources) {
    const skillId = `${src.companion}:${src.skillId}`
    const raw = fetchRaw(ghBin, src.repo, src.path)
    if (raw === null) {
      failures.push(`${skillId} (${src.repo}/${src.path})`)
      continue
    }
    companions[skillId] = [...lineHashSet(raw)].sort()
  }

  if (failures.length > 0) {
    process.stderr.write(
      `${LABEL} FAIL-CLOSED -- could not fetch ${failures.length} upstream source(s), refusing to write a partial hash file:\n`,
    )
    for (const f of failures) process.stderr.write(`  ${f}\n`)
    process.stderr.write(
      `${LABEL} offline, no gh auth, or upstream unreachable -- the committed hash file is unchanged and remains authoritative.\n`,
    )
    return 1
  }

  const doc = {
    $schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    companions,
  }
  mkdirSync(dirname(hashesPath), { recursive: true })
  writeFileSync(hashesPath, JSON.stringify(doc, null, 2) + '\n')
  process.stdout.write(
    `${LABEL} wrote ${hashesPath} (${Object.keys(companions).length} companion skills)\n`,
  )
  return 0
}

// ── Self-test (pure fixtures, no network) ─────────────────────────────────────

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'skill-provenance-self-test-'))
  try {
    // A companion "skill" with OVERLAP_THRESHOLD known substantive lines.
    const companionLines = Array.from(
      { length: OVERLAP_THRESHOLD },
      (_, i) => `this is companion substantive line number ${i} used for the self-test fixture`,
    )
    const hashesDoc = {
      $schemaVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      companions: { 'superpowers:probe': companionLines.map(hashLine) },
    }
    const hashesPath = join(dir, 'hashes.json')
    writeFileSync(hashesPath, JSON.stringify(hashesDoc))

    // Clean tree: an authored skill with wholly original prose (0 overlap).
    const cleanRoot = join(dir, 'clean')
    mkdirSync(join(cleanRoot, '.claude/skills/example'), { recursive: true })
    writeFileSync(
      join(cleanRoot, '.claude/skills/example/SKILL.md'),
      '---\nname: example\n---\n\nAn entirely original arbiter-authored sentence about testing.\n',
    )
    const cleanExit = runGate({ root: cleanRoot, hashesPath, threshold: OVERLAP_THRESHOLD })
    if (cleanExit !== 0) {
      process.stderr.write(`${LABEL} self-test FAILED: clean tree reported exit ${cleanExit}\n`)
      return 1
    }

    // Dirty tree: reproduces every companion line verbatim, genuinely crossing OVERLAP_THRESHOLD.
    const dirtyRoot = join(dir, 'dirty')
    mkdirSync(join(dirtyRoot, '.claude/skills/example'), { recursive: true })
    writeFileSync(
      join(dirtyRoot, '.claude/skills/example/SKILL.md'),
      `---\nname: example\n---\n\n${companionLines.join('\n')}\n`,
    )
    const dirtyExit = runGate({ root: dirtyRoot, hashesPath, threshold: OVERLAP_THRESHOLD })
    if (dirtyExit !== 1) {
      process.stderr.write(
        `${LABEL} self-test FAILED: dirty tree reported exit ${dirtyExit}, expected 1\n`,
      )
      return 1
    }

    process.stdout.write(`${LABEL} self-test OK (clean tree passes, overlap tree fails)\n`)
    return 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── Entry point (INV-96: top-level work wrapped, fails closed on error) ──────
// Guarded by isMainModule so the pure functions above stay importable (unit tests) without
// triggering the CLI's process.exit as a side effect of loading the module.

if (isMainModule(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    let exitCode
    if (args.selfTest) {
      exitCode = selfTest()
    } else if (args.refreshHashes) {
      exitCode = runRefresh(args)
    } else {
      exitCode = runGate(args)
    }
    process.exit(exitCode)
  } catch (err) {
    process.stderr.write(`${LABEL} error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(err?.exitCode ?? 2)
  }
}
