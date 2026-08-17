#!/usr/bin/env node
// sync-action-pins.mjs — sync GitHub Action version pins between committed
// .github/workflows/*.yml and the EJS source templates.
//
// Background: dependabot github-actions bumps .github/workflows/*.yml only.
// EJS templates in src/templates/**/workflows/*.yml.ejs are the SSOT for
// downstream-generated workflows, so they must stay in sync. This script
// bridges that gap so parity tests pass on dependabot PRs.
//
// Scope (#2298): INV-76 is corpus-wide — ALL *.ejs under src/templates/**/workflows/
// must carry the committed pin for each action, not just the ~19 templates paired
// with a committed workflow. The committed workflows are the canonical source
// (dependabot-bumped); every template occurrence is compared against them.
//
// Indexing (#2298): pins are indexed per (file, occurrence), NOT per action name.
// The old last-wins Map hid every earlier occurrence of an action from --check,
// so a stale pin survived while the checker declared "in sync".
//
// Modes:
//   node scripts/sync-action-pins.mjs           — write: EJS ← committed yml (default)
//   node scripts/sync-action-pins.mjs --check   — read-only; exit 1 on divergence
//   node scripts/sync-action-pins.mjs --reverse — write: yml ← EJS (pair-scoped)
//
// Exit codes:
//   0 — in sync (or all templates wrote successfully)
//   1 — --check: divergence detected (or --reverse: drift found)
//   2 — invocation error
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { collectWorkflowTemplates } from './lib/workflow-scan.mjs'
import { CROSS_MAJOR_ALLOWLIST } from './lib/action-pins.mjs'

const ROOT = process.cwd()
const WF_DIR = join(ROOT, '.github', 'workflows')
const TPL_ROOT = join(ROOT, 'src', 'templates')

const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const REVERSE = args.includes('--reverse')

if (CHECK && REVERSE) {
  process.stderr.write('sync-action-pins: --check and --reverse are mutually exclusive\n')
  process.exit(2)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Regex: `uses: <action>@<version>` optionally followed by an inline comment `# vX.Y.Z`.
// Captures: [1] = action name, [2] = version (SHA/tag), [3] = full comment token (e.g. "# v6.0.2") or ""
const USES_RE = /uses:\s+([\w@/.:_-]+)@([\w.\-]+)([ \t]*#[^\n]*)?/g
// Same, but captures the whitespace after `uses:` so a write preserves original spacing.
const APPLY_RE = /uses:(\s+)([\w@/.:_-]+)@([\w.\-]+)([ \t]*#[^\n]*)?/g

// All occurrences of `uses:` in a file, in order — never collapsed by action name.
function extractOccurrences(content) {
  const out = []
  for (const match of content.matchAll(USES_RE)) {
    const [, action, version, comment = ''] = match
    out.push({ action, version, comment: comment.trimEnd() })
  }
  return out
}

// Major bucket of a pin comment (`# v7.0.0` → "7", `# v0.24.0` → "0.24", `# stable` → null).
function majorOfComment(comment) {
  const m = /#\s*v(\d+)(?:\.(\d+))?/.exec(comment)
  if (!m) return null
  if (m[1] === '0') return m[2] !== undefined ? `0.${m[2]}` : '0'
  return m[1]
}

// Is this occurrence a DECLARED cross-major split (allowed to differ from canonical)?
function isDeclaredSplit(action, version, comment) {
  const major = majorOfComment(comment)
  if (major === null) return false
  return CROSS_MAJOR_ALLOWLIST[action]?.[major] === version
}

// Does this template occurrence match the canonical (committed) pin?
// Same major → must match version+comment exactly. Different major → only a
// declared cross-major split is tolerated. Template-only actions (no committed
// reference) are not checked here — INV-76 consistency for them is enforced by
// check-action-pins.mjs.
function matchesCanonical(occ, canonical) {
  if (canonical === undefined) return true
  const occMajor = majorOfComment(occ.comment)
  const canonMajor = majorOfComment(canonical.comment)
  if (occMajor === canonMajor) {
    // Compare the version LABEL, not raw whitespace: `@sha # v7.0.1` and
    // `@sha  # v7.0.1` are the same pin, not a drift (#2298 AC-4 no false red).
    return occ.version === canonical.version && occ.comment.trim() === canonical.comment.trim()
  }
  return isDeclaredSplit(occ.action, occ.version, occ.comment)
}

// ─── Canonical pins: committed workflows (dependabot-bumped) ─────────────────

// Committed workflows carry exactly one pin per action (verified), so a flat
// action -> { version, comment } map is the canonical SSOT.
function collectCanonicalPins() {
  const pins = new Map()
  if (!existsSync(WF_DIR)) return pins
  for (const f of readdirSync(WF_DIR)) {
    if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue
    const content = readFileSync(join(WF_DIR, f), 'utf-8')
    for (const occ of extractOccurrences(content)) {
      if (!pins.has(occ.action))
        pins.set(occ.action, { version: occ.version, comment: occ.comment })
    }
  }
  return pins
}

// ─── Reverse mode: yml ← EJS (pair-scoped, per-occurrence) ───────────────────

function templatePinFor(ejsOccurrences, action, ymlComment) {
  const matches = ejsOccurrences.filter((o) => o.action === action)
  if (matches.length === 0) return undefined
  const ymlMajor = majorOfComment(ymlComment)
  if (ymlMajor !== null) {
    const sameMajor = matches.find((o) => majorOfComment(o.comment) === ymlMajor)
    if (sameMajor) return sameMajor
  }
  return matches[0]
}

function runReverse() {
  const wfFiles = existsSync(WF_DIR)
    ? readdirSync(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    : []
  const pairs = []
  for (const wfFile of wfFiles) {
    const ejsFile = wfFile.replace(/\.ya?ml$/, '.yml.ejs')
    const ejsPath = join(TPL_ROOT, 'github', 'workflows', ejsFile)
    if (existsSync(ejsPath)) {
      pairs.push({ yml: join(WF_DIR, wfFile), ejs: ejsPath, name: wfFile })
    }
  }
  if (pairs.length === 0) {
    process.stdout.write('sync-action-pins: no yml↔EJS pairs found — nothing to sync\n')
    process.exit(0)
  }
  let totalDrift = 0
  for (const { yml, ejs, name } of pairs) {
    const ymlContent = readFileSync(yml, 'utf-8')
    const ejsOccurrences = extractOccurrences(readFileSync(ejs, 'utf-8'))
    let pairDrift = 0
    const updated = ymlContent.replace(APPLY_RE, (match, space, action, version, comment = '') => {
      const pin = templatePinFor(ejsOccurrences, action, comment.trimEnd())
      if (pin === undefined) return match
      const occComment = comment.trimEnd()
      if (pin.version === version && pin.comment === occComment) return match
      pairDrift++
      return `uses:${space}${action}@${pin.version}${pin.comment}`
    })
    if (pairDrift > 0) {
      writeFileSync(yml, updated, 'utf-8')
      totalDrift += pairDrift
      process.stdout.write(`sync-action-pins: ${name} — updated ${pairDrift} pin(s) in yml\n`)
    } else {
      process.stdout.write(`sync-action-pins: ${name} — in sync\n`)
    }
  }
  process.stdout.write('\n')
  if (totalDrift > 0) {
    process.stdout.write(
      `sync-action-pins: synced ${totalDrift} pin(s) across ${pairs.length} pair(s)\n`,
    )
  } else {
    process.stdout.write('sync-action-pins: all pairs in sync\n')
  }
}

// ─── Default / --check: EJS ← committed yml (corpus-wide) ────────────────────

function runSync() {
  const canonicalPins = collectCanonicalPins()
  const templateFiles = collectWorkflowTemplates(TPL_ROOT)
  if (templateFiles.length === 0) {
    process.stdout.write('sync-action-pins: no workflow templates found — nothing to sync\n')
    process.exit(0)
  }

  const drifts = []
  for (const file of templateFiles) {
    const rel = file.replace(`${ROOT}/`, '')
    for (const occ of extractOccurrences(readFileSync(file, 'utf-8'))) {
      const canonical = canonicalPins.get(occ.action)
      if (canonical === undefined) continue
      if (matchesCanonical(occ, canonical)) continue
      drifts.push({
        file: rel,
        action: occ.action,
        template: `${occ.version}${occ.comment}`,
        canonical: `${canonical.version}${canonical.comment}`,
      })
    }
  }

  if (CHECK) {
    if (drifts.length > 0) {
      process.stderr.write(
        `sync-action-pins: DRIFT — ${drifts.length} diverged pin(s) across ${templateFiles.length} template(s)\n`,
      )
      for (const d of drifts) {
        process.stderr.write(
          `  ${d.file}: ${d.action} template=${d.template}  canonical=${d.canonical}\n`,
        )
      }
      process.stderr.write('  Fix: node scripts/sync-action-pins.mjs\n')
      process.exit(1)
    }
    process.stdout.write('sync-action-pins: all templates in sync with committed workflows\n')
    process.exit(0)
  }

  let updated = 0
  for (const file of templateFiles) {
    const content = readFileSync(file, 'utf-8')
    const newContent = content.replace(APPLY_RE, (match, space, action, version, comment = '') => {
      const canonical = canonicalPins.get(action)
      if (canonical === undefined) return match
      const occComment = comment.trimEnd()
      const occMajor = majorOfComment(occComment)
      const canonMajor = majorOfComment(canonical.comment)
      if (occMajor === canonMajor) {
        if (canonical.version === version && canonical.comment.trim() === occComment.trim())
          return match
        updated++
        return `uses:${space}${action}@${canonical.version}${canonical.comment}`
      }
      if (isDeclaredSplit(action, version, occComment)) return match
      updated++
      return `uses:${space}${action}@${canonical.version}${canonical.comment}`
    })
    if (newContent !== content) writeFileSync(file, newContent, 'utf-8')
  }

  process.stdout.write('\n')
  if (updated > 0) {
    process.stdout.write(
      `sync-action-pins: synced ${updated} pin(s) across ${templateFiles.length} template(s)\n`,
    )
  } else {
    process.stdout.write('sync-action-pins: all templates in sync with committed workflows\n')
  }
}

if (REVERSE) {
  runReverse()
} else {
  runSync()
}
