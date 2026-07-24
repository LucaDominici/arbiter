#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// issue-readiness.mjs — entry gate ("grill") upstream of every wave (acceptance-anchor P1).
//
// No issue enters a wave (or /ship preflight) until its "done right" target is written
// down IN THE ISSUE: explicit `AC-N:` acceptance criteria beyond the template stock
// lines, non-goals, and the files/contracts it touches. Underspecification is paid as a
// prompt BEFORE dispatch, not as a thrown-away PR after. Orchestration-time tool —
// intentionally NOT wired into check-all (gh/network is forbidden in the gate path).
//
// Usage:
//   node scripts/issue-readiness.mjs --body-file <path> [--emit-comment]
//   node scripts/issue-readiness.mjs --issue <n> [--emit-comment]     # via gh CLI
//
// Output: one JSON line {ready, missing:[…]} on stdout; with --emit-comment and a
// not-ready verdict, the needs-clarification comment body follows after a "---" line.
//
// Exit codes (INV-53): 0 ready · 1 not ready · 2 error (bad args, gh missing/failed)
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assessReadiness, renderClarificationComment } from './lib/acceptance-criteria.mjs'

function loadBody(args) {
  const bodyIdx = args.indexOf('--body-file')
  if (bodyIdx !== -1) {
    const path = args[bodyIdx + 1]
    if (!path) return { error: '--body-file requires a path' }
    try {
      return { body: readFileSync(path, 'utf-8') }
      // FAIL-OPEN-INTENT: the error object is returned; main() surfaces it on stderr and exits 2 — fail-closed at the call site.
    } catch (err) {
      return { error: `cannot read body file: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  const issueIdx = args.indexOf('--issue')
  if (issueIdx !== -1) return loadFromIssue(args[issueIdx + 1])
  return { error: 'usage: issue-readiness.mjs (--body-file <path> | --issue <n>) [--emit-comment]' }
}

function ghFailureDetail(r) {
  if (r.error) return r.error.message
  const stderr = (r.stderr ?? '').trim()
  return stderr !== '' ? stderr : `exit ${r.status}`
}

function loadFromIssue(n) {
  if (!n || !/^\d+$/.test(n)) return { error: '--issue requires a number' }
  const r = spawnSync('gh', ['issue', 'view', n, '--json', 'body'], { encoding: 'utf-8' })
  if (r.error || r.status !== 0) {
    return { error: `gh issue view ${n} failed: ${ghFailureDetail(r)}` }
  }
  try {
    return { body: JSON.parse(r.stdout).body ?? '' }
    // FAIL-OPEN-INTENT: the error object is returned; main() surfaces it on stderr and exits 2 — fail-closed at the call site.
  } catch {
    return { error: `gh issue view ${n} returned unparseable JSON` }
  }
}

function main() {
  const args = process.argv.slice(2)
  const loaded = loadBody(args)
  if (loaded.error) {
    process.stderr.write(`ERROR issue-readiness: ${loaded.error}\n`)
    return 2
  }
  const verdict = assessReadiness(loaded.body)
  console.log(JSON.stringify(verdict))
  if (!verdict.ready && args.includes('--emit-comment')) {
    console.log('---')
    console.log(renderClarificationComment(verdict.missing))
  }
  return verdict.ready ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main())
  } catch (err) {
    console.error(`ERROR issue-readiness: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
}
