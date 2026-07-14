#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: E7 (#1943, M6 read-set + ADR-103 disjointness) — touched-vs-manifest gate. Context
// CATALOG: economy made checkable: a wave group declares what it will WRITE (manifest `Files` row);
// CATALOG: what a worker actually TOUCHED (git diff --name-only base...branch) must stay inside
// CATALOG: that declared write set. An agent that edited outside its manifest also read outside it
// CATALOG: and voided the ADR-103 disjointness assumption — the hard, cheap, high-signal half.
// CATALOG: Rejected fold-in into check-agent-dispatch.mjs: that asserts the dispatch matrix vs the
// CATALOG: compiled derivation (declaration parity), not the post-hoc touched⊆manifest predicate
// CATALOG: (execution inside declaration). Different axis, different lifecycle (plan-time vs harvest).
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (touched outside manifest / missing group section), 2 ERROR.
// Read-set row absent ⇒ advisory stderr, PASS (reads bounded socially, writes mechanically).
//
// Usage (invoked by wave-drain harvest per group — NOT check-all, which has no --plan args):
//   node scripts/check-touched-vs-manifest.mjs --plan <plan.md> --group <G>
//                                        --base <ref> [--branch <b>] [--repo-root <dir>]
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoDefault = resolve(__dirname, '..')

function arg(flag, argv) {
  const i = argv.indexOf(`--${flag}`)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  const eq = argv.find((x) => x.startsWith(`--${flag}=`))
  return eq ? eq.slice(`--${flag}=`.length) : null
}

const argv = process.argv.slice(2)
const PLAN = arg('plan', argv)
const GROUP = arg('group', argv)
const BASE = arg('base', argv)
const BRANCH = arg('branch', argv) // defaults to HEAD
const REPO_ROOT = arg('repo-root', argv) ? resolve(arg('repo-root', argv)) : repoDefault

/**
 * Extract the group's manifest section from the plan.
 * Group section shape (wave-drain Phase 1):
 *   ## Group: <G>
 *   Files: src/a.ts, src/b.ts
 *   Read-set: src/c.ts, docs/x.md
 * @param {string} planSrc
 * @param {string} group
 * @returns {{ files: string[], readSet: string[], found: boolean }}
 */
function extractGroup(planSrc, group) {
  const lines = planSrc.split('\n')
  let inGroup = false
  /** @type {string[]} */
  let files = []
  /** @type {string[]} */
  let readSet = []
  let found = false
  let hasReadSet = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const grpMatch = line.match(/^##\s*Group:\s*(.+?)\s*$/i)
    if (grpMatch) {
      if (inGroup) break // next group starts
      if (grpMatch[1].trim() === group) {
        inGroup = true
        found = true
      } else {
        inGroup = false
      }
      continue
    }
    if (/^##\s/.test(line) && inGroup) break
    if (!inGroup) continue
    const filesMatch = line.match(/^\s*Files?\s*:\s*(.+)$/i)
    if (filesMatch) {
      files = filesMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      continue
    }
    const readMatch = line.match(/^\s*Read-?set\s*:\s*(.+)$/i)
    if (readMatch) {
      readSet = readMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      hasReadSet = true
    }
  }
  return { files, readSet, found, hasReadSet }
}

function gitDiff(base, branch, repoRoot) {
  try {
    const ref = branch ? `${base}...${branch}` : `${base}...HEAD`
    const out = execSync(`git diff --name-only ${ref}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 6000,
    })
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch (err) {
    throw new Error(`git diff failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function main() {
  if (!PLAN || !GROUP || !BASE) {
    process.stderr.write(
      '[check-touched-vs-manifest] ERROR: --plan, --group and --base are required\n',
    )
    return 2
  }
  const planPath = resolve(PLAN)
  if (!existsSync(planPath)) {
    process.stderr.write(`[check-touched-vs-manifest] ERROR: plan not found: ${planPath}\n`)
    return 2
  }
  let planSrc
  try {
    planSrc = readFileSync(planPath, 'utf-8')
  } catch (err) {
    process.stderr.write(
      `[check-touched-vs-manifest] ERROR: cannot read plan: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
  const { files, found, hasReadSet } = extractGroup(planSrc, GROUP)
  if (!found) {
    process.stdout.write(
      `[check-touched-vs-manifest] FAIL: plan has no "## Group: ${GROUP}" section — declaration is the point\n`,
    )
    return 1
  }
  // Advisory: read-set row absent (reads bounded socially, writes mechanically).
  if (!hasReadSet) {
    process.stderr.write(
      `[check-touched-vs-manifest] advisory: group "${GROUP}" declares no Read-set row — reads are bounded socially, not mechanically\n`,
    )
  }
  const writeSet = new Set(files)
  let touched
  try {
    touched = gitDiff(BASE, BRANCH, REPO_ROOT)
  } catch (err) {
    process.stderr.write(
      `[check-touched-vs-manifest] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 2
  }
  /** @type {string[]} */
  const outside = []
  for (const f of touched) {
    if (!writeSet.has(f)) outside.push(f)
  }
  if (outside.length > 0) {
    process.stdout.write(
      `[check-touched-vs-manifest] FAIL: ${outside.length} file(s) touched outside the declared write set for group "${GROUP}":\n` +
        outside.map((f) => `  - ${f}`).join('\n') +
        '\n',
    )
    process.stdout.write(
      `[check-touched-vs-manifest] FAIL: voided ADR-103 disjointness assumption\n`,
    )
    return 1
  }
  process.stdout.write(
    `[check-touched-vs-manifest] OK — ${touched.length} touched file(s) ⊆ manifest (${files.length} declared) for group "${GROUP}"\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(
    `[check-touched-vs-manifest] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
