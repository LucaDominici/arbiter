#!/usr/bin/env node
// sync-action-pins.mjs — sync GitHub Action version pins between committed
// .github/workflows/*.yml and their EJS source templates.
//
// Background: dependabot github-actions bumps .github/workflows/*.yml only.
// EJS templates in src/templates/github/workflows/*.yml.ejs are the SSOT for
// downstream-generated workflows, so they must stay in sync. This script
// bridges that gap so parity tests pass on dependabot PRs.
//
// Modes:
//   node scripts/sync-action-pins.mjs           — write: EJS ← yml (default)
//   node scripts/sync-action-pins.mjs --check   — read-only; exit 1 on divergence
//   node scripts/sync-action-pins.mjs --reverse — write: yml ← EJS
//
// Exit codes:
//   0 — in sync (or all pairs wrote successfully)
//   1 — --check: divergence detected (or --reverse: drift found)
//   2 — invocation error
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const WF_DIR = join(ROOT, '.github', 'workflows')
const TPL_DIR = join(ROOT, 'src', 'templates', 'github', 'workflows')

const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const REVERSE = args.includes('--reverse')

if (CHECK && REVERSE) {
  process.stderr.write('sync-action-pins: --check and --reverse are mutually exclusive\n')
  process.exit(2)
}

// ─── Build pairs: only files present on BOTH sides ───────────────────────────

const wfFiles = existsSync(WF_DIR)
  ? readdirSync(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : []

const pairs = []
for (const wfFile of wfFiles) {
  const ejsFile = wfFile.replace(/\.ya?ml$/, '.yml.ejs')
  const ejsPath = join(TPL_DIR, ejsFile)
  if (existsSync(ejsPath)) {
    pairs.push({ yml: join(WF_DIR, wfFile), ejs: ejsPath, name: wfFile })
  }
}

if (pairs.length === 0) {
  process.stdout.write('sync-action-pins: no yml↔EJS pairs found — nothing to sync\n')
  process.exit(0)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Regex: `uses: <action>@<version>` optionally followed by an inline comment `# vX.Y.Z`.
// Captures: [1] = action name, [2] = version (SHA/tag), [3] = full comment token (e.g. "# v6.0.2") or ""
// The comment group is optional — absent on lines without a version comment.
const USES_RE = /uses:\s+([\w@/.:_-]+)@([\w.\-]+)([ \t]*#[^\n]*)?/g

function extractPins(content) {
  const pins = new Map()
  for (const match of content.matchAll(USES_RE)) {
    const [, action, version, comment = ''] = match
    pins.set(action, { version, comment: comment.trimEnd() })
  }
  return pins
}

function applyPins(content, sourcePins) {
  // Replace uses: <action>@<oldVersion> [# old-comment] with the source version+comment.
  // Both the SHA/tag and the trailing version comment are updated atomically so that
  // comment-only drift (e.g. "# v4.2.2" vs "# v6.0.2") is also corrected.
  return content.replace(
    /uses:(\s+)([\w@/.:_-]+)@([\w.\-]+)([ \t]*#[^\n]*)?/g,
    (match, space, action, oldVersion, oldComment = '') => {
      const pin = sourcePins.get(action)
      if (pin === undefined) return match
      const { version: newVersion, comment: newComment } = pin
      if (newVersion === oldVersion && newComment === oldComment.trimEnd()) return match
      return `uses:${space}${action}@${newVersion}${newComment}`
    },
  )
}

function diffPins(aPins, bPins, aLabel, bLabel) {
  const diffs = []
  for (const [action, aPin] of aPins) {
    const bPin = bPins.get(action)
    if (bPin === undefined) continue
    // Treat version drift OR comment drift as a difference requiring sync.
    if (aPin.version !== bPin.version || aPin.comment !== bPin.comment) {
      const aStr = `${aPin.version}${aPin.comment}`
      const bStr = `${bPin.version}${bPin.comment}`
      diffs.push({ action, [aLabel]: aStr, [bLabel]: bStr })
    }
  }
  return diffs
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let totalDrift = 0

for (const { yml, ejs, name } of pairs) {
  const ymlContent = readFileSync(yml, 'utf-8')
  const ejsContent = readFileSync(ejs, 'utf-8')

  const ymlPins = extractPins(ymlContent)
  const ejsPins = extractPins(ejsContent)

  if (REVERSE) {
    // ejs → yml
    const diffs = diffPins(ejsPins, ymlPins, 'ejs', 'yml')
    if (diffs.length === 0) {
      process.stdout.write(`sync-action-pins: ${name} — in sync\n`)
      continue
    }
    totalDrift += diffs.length
    const updated = applyPins(ymlContent, ejsPins)
    writeFileSync(yml, updated, 'utf-8')
    process.stdout.write(`sync-action-pins: ${name} — updated ${diffs.length} pin(s) in yml\n`)
    for (const d of diffs) {
      process.stdout.write(`  ${d.action}: yml ${d.yml} → ${d.ejs}\n`)
    }
    continue
  }

  // yml → ejs (default / --check)
  const diffs = diffPins(ymlPins, ejsPins, 'yml', 'ejs')
  if (diffs.length === 0) {
    process.stdout.write(`sync-action-pins: ${name} — in sync\n`)
    continue
  }

  totalDrift += diffs.length

  if (CHECK) {
    process.stderr.write(`sync-action-pins: DRIFT — ${name} has ${diffs.length} diverged pin(s)\n`)
    for (const d of diffs) {
      process.stderr.write(`  ${d.action}: yml=${d.yml}  ejs=${d.ejs}\n`)
    }
    continue
  }

  const updated = applyPins(ejsContent, ymlPins)
  writeFileSync(ejs, updated, 'utf-8')
  process.stdout.write(`sync-action-pins: ${name} — updated ${diffs.length} pin(s) in EJS\n`)
  for (const d of diffs) {
    process.stdout.write(`  ${d.action}: ${d.ejs} → ${d.yml}\n`)
  }
}

process.stdout.write('\n')

if (CHECK && totalDrift > 0) {
  process.stderr.write(
    `sync-action-pins: FAIL — ${totalDrift} diverged pin(s) across ${pairs.length} pair(s)\n`,
  )
  process.stderr.write('  Fix: node scripts/sync-action-pins.mjs\n')
  process.exit(1)
}

if (totalDrift === 0) {
  process.stdout.write('sync-action-pins: all pairs in sync\n')
} else if (!CHECK) {
  process.stdout.write(
    `sync-action-pins: synced ${totalDrift} pin(s) across ${pairs.length} pair(s)\n`,
  )
}
