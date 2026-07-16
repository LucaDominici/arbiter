#!/usr/bin/env node
// arbiter — done-evidence CLI (INV-38)
// Captures SHA-256 of load-bearing source files + gate state into
//   .claude/.last-done-evidence.json
// Guards against "done" claims when source drifted after gate ran.
//
// Usage: node scripts/done-evidence.mjs
//
// Workflow:
//   1. Runs the L4 gate (node scripts/check-all.mjs L4)
//   2. If green: captures SHA-256 of all files in evidence-files.json
//      and writes .claude/.last-done-evidence.json
//   3. If red: prints failures, exits 1
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, extname, relative } from 'node:path'

// Anchor all paths to the repo root so the script is CWD-independent
const _rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' })
if (_rootResult.status !== 0) {
  process.stderr.write('[done-evidence] ERROR: not inside a git repository\n')
  process.exit(1)
}
process.chdir(_rootResult.stdout.trim())

const EVIDENCE_PATH = '.claude/.last-done-evidence.json'
const CONFIG_PATH = 'evidence-files.json'
const STATUS_PATH = '.claude/.task/status.json'

/** Read evidence-files.json config or exit 1 on corrupt JSON. */
function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    let raw
    try {
      raw = readFileSync(CONFIG_PATH, 'utf-8')
    } catch (e) {
      process.stderr.write(
        `[done-evidence] ERROR: could not read evidence-files.json — ${e.code ?? e.message}\n`,
      )
      process.exit(1)
    }
    try {
      return JSON.parse(raw)
    } catch (e) {
      process.stderr.write(
        `[done-evidence] ERROR: evidence-files.json is invalid JSON — ${e.message}\n`,
      )
      process.stderr.write(
        '[done-evidence] Fix or delete evidence-files.json before running done-evidence.\n',
      )
      process.exit(1)
    }
  }
  return {
    pin_dirs: ['src'],
    pin_extensions: ['.ts', '.tsx', '.mjs', '.js'],
    exclude_dirs: ['node_modules', 'dist', 'build', 'coverage', '.git'],
  }
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
])

/** Recursively walk a directory; call fn(absolutePath) for each file. */
function walk(dir, fn, excludeDirs) {
  const exclude = new Set([...SKIP_DIRS, ...(excludeDirs ?? [])])
  let entries
  try {
    entries = readdirSync(dir)
  } catch (e) {
    process.stderr.write(
      `[done-evidence] WARN: could not read directory ${dir} (${e.code ?? e.message}) — files in this directory will not be pinned\n`,
    )
    return
  }
  for (const entry of entries) {
    if (exclude.has(entry)) continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch (e) {
      process.stderr.write(
        `[done-evidence] WARN: could not stat ${full} (${e.code ?? e.message}) — skipping\n`,
      )
      continue
    }
    if (stat.isDirectory()) {
      walk(full, fn, excludeDirs)
    } else {
      fn(full)
    }
  }
}

/** SHA-256 of file contents; returns null and logs WARN on read error. */
function sha256File(absPath) {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex')
  } catch (e) {
    process.stderr.write(
      `[done-evidence] WARN: could not hash ${absPath} (${e.code ?? e.message}) — skipping\n`,
    )
    return null
  }
}

// ─── Step 1: Run L4 gate ─────────────────────────────────────────────────────

process.stdout.write('[done-evidence] Running L4 gate...\n')
const gate = spawnSync('node', ['scripts/check-all.mjs', 'L4'], {
  stdio: 'inherit',
  shell: false,
})

if (gate.error) {
  process.stderr.write(
    `\n[done-evidence] ERROR: could not launch gate command — ${gate.error.message}\n` +
      `  Ensure 'node' is in PATH and 'scripts/check-all.mjs' exists.\n`,
  )
  process.exit(1)
}

if (gate.status === null) {
  process.stderr.write(
    `\n[done-evidence] Gate process killed by signal (${gate.signal ?? 'unknown'}) — possibly OOM or timeout.\n`,
  )
  process.exit(1)
}

if (gate.status !== 0) {
  process.stderr.write(
    '\n[done-evidence] Gate FAILED — fix the issues above before capturing done evidence.\n',
  )
  process.exit(1)
}

// ─── Step 1.5: Reality-contact suite (archetype-aware, #1368/#1703, anti-fake-green) ─
// For archetypes that ship a running artifact, exercise the live binary and record
// HONEST reality-contact evidence — never fabricate `passed:true`. Configurable via
// evidence-files.json `reality_contact`: { archetype, required, suite, command }.
// Default (backend-web-db): the live api-e2e runner (tests/api/run.sh) the api-e2e
// generator emits for every service language — boots the real binary in-test.
// Non-service archetypes: required:false (no live artifact to exercise).
const config = loadConfig()
const DEFAULT_RC = {
  archetype: 'library',
  required: false,
  suite: 'live-api-e2e',
  command: '',
}
const rcConfig =
  config && typeof config.reality_contact === 'object'
    ? { ...DEFAULT_RC, ...config.reality_contact }
    : DEFAULT_RC

let realityContact
let noOverclaim = false
if (rcConfig.required !== true) {
  // Non-service archetype — no live artifact to exercise; reality contact is N/A.
  realityContact = {
    archetype: rcConfig.archetype,
    required: false,
    suite: rcConfig.suite,
    recorded_at: new Date().toISOString(),
    passed: null,
    detail: 'not required for this archetype',
  }
  noOverclaim = true
} else {
  const rcCmd = String(rcConfig.command || '').trim()
  if (rcCmd.length === 0) {
    process.stderr.write(
      '\n[done-evidence] ERROR: reality_contact.command is empty — cannot exercise live artifact.\n' +
        '  Set evidence-files.json `reality_contact.command` to a suite that boots the real binary.\n',
    )
    process.exit(1)
  }
  const rcArgs = rcCmd.split(/\s+/)
  process.stdout.write(`[done-evidence] Running reality-contact suite: ${rcCmd}\n`)
  const rc = spawnSync(rcArgs[0], rcArgs.slice(1), {
    stdio: 'inherit',
    shell: false,
  })
  const rcPassed = rc.status === 0
  realityContact = {
    archetype: rcConfig.archetype,
    required: true,
    suite: rcConfig.suite,
    command: rcCmd,
    recorded_at: new Date().toISOString(),
    passed: rcPassed,
  }
  if (!rcPassed) {
    process.stderr.write(
      `\n[done-evidence] Reality-contact suite FAILED (exit ${rc.status ?? 'signal:' + (rc.signal ?? '?')}) — ` +
        `fix the failing live e2e before capturing done evidence. No fake green.\n`,
    )
    process.exit(1)
  }
  // Gate green + reality contact exercised + SHAs pinned below ⇒ no overclaim.
  noOverclaim = true
}

// ─── Step 2: Gather pinned files ─────────────────────────────────────────────

const pinDirs = Array.isArray(config.pin_dirs) ? config.pin_dirs : ['src']
const pinExts = new Set(Array.isArray(config.pin_extensions) ? config.pin_extensions : ['.ts'])
const excludeDirs = Array.isArray(config.exclude_dirs) ? config.exclude_dirs : []

const pinnedFiles = []

for (const dir of pinDirs) {
  if (!existsSync(dir)) continue
  walk(
    dir,
    (absPath) => {
      if (pinExts.has(extname(absPath))) {
        const relPath = relative(process.cwd(), absPath).replace(/\\/g, '/')
        const sha = sha256File(absPath)
        if (sha !== null) {
          pinnedFiles.push({ path: relPath, sha256: sha })
        }
      }
    },
    excludeDirs,
  )
}

// ─── Step 3: Read task ID ─────────────────────────────────────────────────────

let taskId = 'unknown'
if (existsSync(STATUS_PATH)) {
  try {
    taskId = JSON.parse(readFileSync(STATUS_PATH, 'utf-8')).taskId || 'unknown'
    // FAIL-OPEN-INTENT: corrupt/missing status.json is not fatal — pinned-file SHAs still carry the evidence.
  } catch {
    taskId = 'unknown'
  }
}

// ─── Step 4: Write evidence JSON ──────────────────────────────────────────────

const evidence = {
  version: 1,
  captured_at: new Date().toISOString(),
  task_id: taskId,
  all_green: true,
  gate_level: 'L4',
  pinned_files: pinnedFiles,
  reality_contact: realityContact,
  no_overclaim: noOverclaim,
}

try {
  mkdirSync('.claude', { recursive: true })
  writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n', 'utf-8')
} catch (e) {
  process.stderr.write(
    `[done-evidence] ERROR: could not write evidence file — ${e.code ?? e.message}\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `[done-evidence] Evidence captured.\n` +
    `  task_id:           ${taskId}\n` +
    `  pinned_files:      ${pinnedFiles.length}\n` +
    `  reality_contact:   ${realityContact.suite} passed=${realityContact.passed}\n` +
    `  no_overclaim:      ${noOverclaim}\n` +
    `  written to:        ${EVIDENCE_PATH}\n`,
)
