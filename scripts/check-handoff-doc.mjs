#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E6a (#1943, M1) — handoff-lint. Flags a handoff doc whose tasks carry no tier
// CATALOG: suggestion (silently re-routes work to the expensive model — R7) or no executable
// CATALOG: `Verify:` command (a cold model cannot execute the plan — R1). Lints the contract
// CATALOG: the HANDOFF template already promises (src/templates/HANDOFF.template.md): each
// CATALOG: numbered task section (`### N.`) must carry What / Where / AC / Verify / Suggested tier,
// CATALOG: `Verify:` must contain a backtick command, and `Suggested tier:` must be non-empty and
// CATALOG: not the template placeholder.
// CATALOG: Rejected fold-in into check-doc-style.mjs: that lints prose style/SPDX/frontmatter,
// CATALOG: not the handoff task-section contract (different shape, different failure surface).
// CATALOG: Rejected fold-in into check-canonical-paths.mjs: path-target existence, not task shape.
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (one+ handoff violates), 2 ERROR (self).
// Vacuous pass when no handoff docs exist. Advisory at land-time (runWarnCheck); promote to
// runCheck to hard-block.
//
// Usage:
//   node scripts/check-handoff-doc.mjs [--file <path>] [--root <dir>]
//     --file   lint a single file
//     --root   scan **/HANDOFF*.md plus docs/**/Handoff:*.md and .claude/plans/** (default cwd)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg } from './lib/gate-args.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const FILE_ARG = arg('file', argv)
const ROOT = arg('root', argv) ? resolve(arg('root', argv)) : process.cwd()
const TEMPLATE_PATH = join(repoDefault, 'src', 'templates', 'HANDOFF.template.md')

const PLACEHOLDER = /(…|_fill in_|<[^>]*>)/

/** Is this file the template itself (exempt — it IS placeholders)? */
function isTemplate(absPath) {
  try {
    return resolve(absPath) === resolve(TEMPLATE_PATH)
    // FAIL-OPEN-INTENT: resolve() threw on a bad path — treat as not-the-template (safe default: the file gets linted).
  } catch {
    return false
  }
}

/** Walk a directory recursively collecting markdown files. */
function walkMarkdown(dir, out) {
  let entries
  try {
    entries = readdirSync(dir)
    // FAIL-OPEN-INTENT: readdirSync failure on a non-existent dir — nothing to walk; empty out is correct.
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
      // FAIL-OPEN-INTENT: statSync ENOENT race — skip the entry; rethrow would false-positive on a racing delete.
    } catch {
      continue
    }
    if (st.isDirectory()) walkMarkdown(full, out)
    else if (entry.endsWith('.md')) out.push(full)
  }
}

/** Collect handoff docs: files named HANDOFF*.md anywhere, plus markdown whose H1 starts with "Handoff:". */
function collectHandoffs(root) {
  /** @type {string[]} */
  const out = []
  const all = []
  walkMarkdown(root, all)
  for (const f of all) {
    const base = f.split(sep).pop() ?? ''
    if (/^HANDOFF.*\.md$/i.test(base)) {
      out.push(f)
      continue
    }
    // H1 starts with "Handoff:" and the file is under docs/ or .claude/plans/
    const rel = relative(root, f)
    if (/^(docs|\.claude\/plans)\b/.test(rel.replace(/\\/g, '/'))) {
      try {
        const head = readFileSync(f, 'utf-8').split('\n').slice(0, 5).join('\n')
        if (/^#\s*Handoff:/im.test(head)) out.push(f)
        // FAIL-OPEN-INTENT: readFileSync failure on a candidate file — skip it (unreadable files are not linted, matching check-doc-style posture).
      } catch {
        /* unreadable → skip */
      }
    }
  }
  return out
}

/**
 * Lint one handoff doc. Returns array of violation messages (empty = pass).
 * @param {string} absPath
 * @returns {string[]}
 */
function lintHandoff(absPath) {
  let src
  try {
    src = readFileSync(absPath, 'utf-8')
    // FAIL-OPEN-INTENT: readFileSync failure is returned as a violation string (err.message surfaced to the caller — fail-closed).
  } catch (err) {
    return [`cannot read ${absPath}: ${err instanceof Error ? err.message : String(err)}`]
  }
  /** @type {string[]} */
  const violations = []
  // Split into numbered task sections: `### N.` headings.
  const heads = [...src.matchAll(/^### \d+\b.*$/gm)]
  if (heads.length === 0) {
    // No numbered task sections → nothing to lint (handoff may be a different shape). Not a fail.
    return []
  }
  const REQUIRED_ROWS = ['What', 'Where', 'AC', 'Verify', 'Suggested tier']
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index
    const end = i + 1 < heads.length ? heads[i + 1].index : src.length
    const section = src.slice(start, end)
    const title = heads[i][0].trim()
    for (const row of REQUIRED_ROWS) {
      const re = new RegExp(`\\*\\*${row}:\\*\\*`, 'i')
      if (!re.test(section)) {
        violations.push(`${absPath}: ${title} — missing "**${row}:**" row`)
      }
    }
    // Verify must contain a backtick command.
    const verifyMatch = section.match(/\*\*Verify:\*\*\s*([^\n]*)/i)
    if (verifyMatch && !/`[^`]+`/.test(verifyMatch[1])) {
      violations.push(`${absPath}: ${title} — "Verify:" must contain a backtick command`)
    }
    // Suggested tier must be non-empty and not a placeholder.
    const tierMatch = section.match(/\*\*Suggested tier:\*\*\s*([^\n]*)/i)
    if (tierMatch) {
      const val = tierMatch[1].trim()
      if (val === '' || PLACEHOLDER.test(val)) {
        violations.push(`${absPath}: ${title} — "Suggested tier:" is empty or a placeholder`)
      }
    }
  }
  return violations
}

function main() {
  /** @type {string[]} */
  let files
  if (FILE_ARG) {
    files = [resolve(FILE_ARG)]
  } else {
    files = collectHandoffs(ROOT).filter((f) => !isTemplate(f))
  }
  let totalViolations = 0
  let checked = 0
  for (const f of files) {
    if (!existsSync(f)) {
      process.stderr.write(`[check-handoff-doc] ERROR: file not found: ${f}\n`)
      return 2
    }
    if (isTemplate(f)) continue
    checked++
    const v = lintHandoff(f)
    for (const msg of v) process.stdout.write(`[check-handoff-doc] FAIL: ${msg}\n`)
    totalViolations += v.length
  }
  if (totalViolations > 0) {
    process.stdout.write(
      `[check-handoff-doc] FAIL: ${totalViolations} violation(s) across ${checked} handoff doc(s)\n`,
    )
    return 1
  }
  process.stdout.write(`[check-handoff-doc] OK — ${checked} handoff doc(s) passed\n`)
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(
    `[check-handoff-doc] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
