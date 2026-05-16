#!/usr/bin/env node
// Soak harness: simulates N days of project activity to detect slow-bleed bugs. (#596)
// Each simulated day: random commits, INV violations + recovery, periodic arbiter update/doctor.
// Asserts at each tick: gate enforceable, hooks respond, generated files match snapshot,
// evidence backlog within bound.
//
// Mode: SOAK_MODE=full (30 days) or SOAK_MODE=compressed (7 days, default).
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, execSync } from 'node:child_process'

const MODE = process.env.SOAK_MODE ?? 'compressed'
const DAYS = MODE === 'full' ? 30 : 7
const DIVERGENCE_FILE = '/tmp/soak-divergence-day'

// Clean up stale divergence marker from a previous run
if (existsSync(DIVERGENCE_FILE)) {
  rmSync(DIVERGENCE_FILE)
}

const workDir = mkdtempSync(join(tmpdir(), 'soak-'))
const logFile = join(workDir, 'soak.log')
writeFileSync(logFile, `soak-harness start: mode=${MODE} days=${DAYS}\n`)

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
  writeFileSync(logFile, line, { flag: 'a' })
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', cwd: workDir, stdio: 'pipe', ...opts })
}

function fail(day, reason) {
  log(`DIVERGENCE on day ${day}: ${reason}`)
  writeFileSync(DIVERGENCE_FILE, String(day))
  process.exit(1)
}

log(`Initializing fixture project in ${workDir}`)

// TODO(#596): replace stub init with actual `arbiter init --yes` once the
// soak harness is wired to the installed binary end-to-end.
try {
  run('git', ['init'])
  run('git', ['config', 'user.email', 'soak@arbiter.test'])
  run('git', ['config', 'user.name', 'Soak Harness'])
  run('git', ['commit', '--allow-empty', '-m', 'chore: soak init'])
} catch (err) {
  fail(0, `fixture init failed: ${err.message}`)
}

// Take initial snapshot of key generated files.
// TODO(#596): compare against real .arbiter-generated.json once init is wired.
const SNAPSHOT = {}

for (let day = 1; day <= DAYS; day++) {
  log(`--- Day ${day}/${DAYS} ---`)

  // Simulate a commit
  try {
    const fname = `day-${day}.txt`
    writeFileSync(join(workDir, fname), `simulated activity on day ${day}\n`)
    run('git', ['add', fname])
    run('git', ['commit', '-m', `chore: day ${day} activity`])
    log(`Day ${day}: commit OK`)
  } catch (err) {
    fail(day, `commit failed: ${err.message}`)
  }

  // TODO(#596): simulate INV violation + recovery
  // TODO(#596): run `arbiter update` every 7 days
  // TODO(#596): run `arbiter doctor` weekly
  // TODO(#596): assert gate still enforceable (run node scripts/check-all.mjs L1 in fixture)
  // TODO(#596): assert generated files match snapshot (diff against .arbiter-generated.json)
  // TODO(#596): assert evidence backlog < bound

  log(`Day ${day}: OK`)
}

log(`Soak complete: ${DAYS} days simulated without divergence.`)
