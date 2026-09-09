#!/usr/bin/env node
// arbiter — done-evidence CLI (INV-38)
// Captures SHA-256 of load-bearing source files + gate state into
//   .claude/.last-done-evidence.json
// Guards against "done" claims when source drifted after gate ran.
//
// Usage: node scripts/done-evidence.mjs
//
// Workflow:
//   1. Runs the L3 gate (node scripts/check-all.mjs L3)
//   2. If green: captures SHA-256 of all files in evidence-files.json
//      and writes .claude/.last-done-evidence.json
//   3. If red: prints failures, exits 1
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, extname, relative } from 'node:path'
import { verifyGateEvidenceFile } from './lib/gate-evidence.mjs'

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

function sanitizeTaskId(raw) {
  const cleaned = String(raw)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'unknown'
}

let taskId = 'unknown'
if (existsSync(STATUS_PATH)) {
  try {
    taskId = JSON.parse(readFileSync(STATUS_PATH, 'utf-8')).taskId || 'unknown'
  } catch {
    taskId = 'unknown'
  }
}

const DONE_RECEIPT_PATH = join('.arbiter', 'evidence', 'done', `${sanitizeTaskId(taskId)}.json`)
const LEGACY_PATH = join('.arbiter', 'evidence', 'done', 'legacy', `${sanitizeTaskId(taskId)}.json`)

function writeReceipt(state, details = {}) {
  const dir = join('.arbiter', 'evidence', 'done')
  const temp = `${DONE_RECEIPT_PATH}.${process.pid}.tmp`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      temp,
      JSON.stringify({
        version: 2,
        task_id: taskId,
        state,
        recorded_at: new Date().toISOString(),
        ...details,
      }) + '\n',
      'utf-8',
    )
    renameSync(temp, DONE_RECEIPT_PATH)
    return true
  } catch (e) {
    process.stderr.write(
      `[done-evidence] ERROR: could not write ${state} receipt — ${e.code ?? e.message}\n`,
    )
    return false
  }
}

function fail(message) {
  writeReceipt('failed')
  process.stderr.write(message)
  process.exit(1)
}

// A new attempt must invalidate an older PASS before any config or gate work.
if (!writeReceipt('pending')) process.exit(1)

if (existsSync(EVIDENCE_PATH)) {
  try {
    mkdirSync(join('.arbiter', 'evidence', 'done', 'legacy'), { recursive: true })
    renameSync(EVIDENCE_PATH, LEGACY_PATH)
  } catch (e) {
    fail(`[done-evidence] ERROR: could not migrate legacy evidence — ${e.code ?? e.message}\n`)
  }
}

/** Read evidence-files.json config or exit 1 on corrupt JSON. */
function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    let raw
    try {
      raw = readFileSync(CONFIG_PATH, 'utf-8')
    } catch (e) {
      fail(`[done-evidence] ERROR: could not read evidence-files.json — ${e.code ?? e.message}\n`)
    }
    try {
      return JSON.parse(raw)
    } catch (e) {
      fail(
        `[done-evidence] ERROR: evidence-files.json is invalid JSON — ${e.message}\n` +
          '[done-evidence] Fix or delete evidence-files.json before running done-evidence.\n',
      )
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
    fail(`[done-evidence] ERROR: could not read directory ${dir} — ${e.code ?? e.message}\n`)
  }
  for (const entry of entries) {
    if (exclude.has(entry)) continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch (e) {
      fail(`[done-evidence] ERROR: could not stat ${full} — ${e.code ?? e.message}\n`)
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
    fail(`[done-evidence] ERROR: could not hash ${absPath} — ${e.code ?? e.message}\n`)
  }
}

// ─── Step 1: Read config, then run L3 gate ────────────────────────────────────

const config = loadConfig()

process.stdout.write('[done-evidence] Running L3 gate...\n')
const markerPath = join('.arbiter', 'gate-pass.json')
let markerVerdict = verifyGateEvidenceFile(markerPath, {
  root: process.cwd(),
  minLevel: 'L3',
  taskId,
})
if (markerVerdict.ok) {
  process.stdout.write('[done-evidence] Reusing valid L3 gate evidence.\n')
} else {
  const gate = spawnSync('node', ['scripts/check-all.mjs', 'L3'], {
    stdio: 'inherit',
    shell: false,
  })
  if (gate.error) {
    fail(
      `\n[done-evidence] ERROR: could not launch gate command — ${gate.error.message}\n` +
        `  Ensure 'node' is in PATH and 'scripts/check-all.mjs' exists.\n`,
    )
  }
  if (gate.status === null) {
    fail(
      `\n[done-evidence] Gate process killed by signal (${gate.signal ?? 'unknown'}) — possibly OOM or timeout.\n`,
    )
  }
  if (gate.status !== 0) {
    fail('\n[done-evidence] Gate FAILED — fix the issues above before capturing done evidence.\n')
  }
  markerVerdict = verifyGateEvidenceFile(markerPath, {
    root: process.cwd(),
    minLevel: 'L3',
    taskId,
  })
  if (!markerVerdict.ok)
    fail(`[done-evidence] ERROR: L3 marker is invalid after gate: ${markerVerdict.reason}\n`)
}

// ─── Step 1.5: Reality-contact suite (archetype-aware, #1368/#1703, anti-fake-green) ─
// For archetypes that ship a running artifact, exercise the live binary and record
// HONEST reality-contact evidence — never fabricate `passed:true`. Configurable via
// evidence-files.json `reality_contact`: { archetype, required, suite, command }.
// Default (backend-web-db): the live api-e2e runner (tests/api/run.sh) the api-e2e
// generator emits for every service language — boots the real binary in-test.
// Non-service archetypes: required:false (no live artifact to exercise).
const DEFAULT_RC = {
  archetype: 'library',
  required: false,
  suite: 'live-api-e2e',
  command: '',
}
const configuredRc =
  config && config.reality_contact !== null && typeof config.reality_contact === 'object'
    ? config.reality_contact
    : {}
const rcConfig = {
  ...DEFAULT_RC,
  ...configuredRc,
  required: DEFAULT_RC.required || configuredRc.required === true,
}

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
    fail(
      '\n[done-evidence] ERROR: reality_contact.command is empty — cannot exercise live artifact.\n' +
        '  Set evidence-files.json `reality_contact.command` to a suite that boots the real binary.\n',
    )
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
    fail(
      `\n[done-evidence] Reality-contact suite FAILED (exit ${rc.status ?? 'signal:' + (rc.signal ?? '?')}) — ` +
        `fix the failing live e2e before capturing done evidence. No fake green.\n`,
    )
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

let gateMarkerBytes
const finalMarkerVerdict = verifyGateEvidenceFile(markerPath, {
  root: process.cwd(),
  minLevel: 'L3',
  taskId,
})
if (!finalMarkerVerdict.ok)
  fail(
    `[done-evidence] ERROR: L3 marker drifted after runtime checks: ${finalMarkerVerdict.reason}\n`,
  )
try {
  gateMarkerBytes = readFileSync(markerPath)
} catch (e) {
  fail(`[done-evidence] ERROR: could not read gate-pass marker — ${e.code ?? e.message}\n`)
}

let marker
try {
  marker = JSON.parse(gateMarkerBytes)
} catch (e) {
  fail(`[done-evidence] ERROR: gate-pass marker is invalid JSON — ${e.message}\n`)
}

if (
  !writeReceipt('passed', {
    all_green: true,
    gate_level: 'L3',
    pinned_files: pinnedFiles,
    reality_contact: realityContact,
    no_overclaim: noOverclaim,
    gate_marker_sha256: createHash('sha256').update(gateMarkerBytes).digest('hex'),
    head_sha: marker.head_sha,
    tree_hash: marker.tree_hash,
    checkout_root: marker.checkout_root,
    toolchain_fingerprint: marker.toolchain_fingerprint,
    node_version: marker.node_version,
  })
)
  process.exit(1)

process.stdout.write(
  `[done-evidence] Evidence captured.\n` +
    `  task_id:           ${taskId}\n` +
    `  pinned_files:      ${pinnedFiles.length}\n` +
    `  reality_contact:   ${realityContact.suite} passed=${realityContact.passed}\n` +
    `  no_overclaim:      ${noOverclaim}\n` +
    `  written to:        ${DONE_RECEIPT_PATH}\n`,
)
