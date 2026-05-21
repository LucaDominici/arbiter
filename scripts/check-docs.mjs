#!/usr/bin/env node
// arbiter — Docs gate: if src/ or __tests__/ changed since the merge-base with origin/main,
// docs/ or README.md must also change.
//
// Rebased-aware: uses `git merge-base HEAD origin/main` so a rebased branch only sees its own
// commits (not main commits replayed underneath). Falls back to `origin/main` then `main` if the
// remote ref is missing locally.
//
// Bypass: any commit message in the diff range containing `[skip-docs]` causes the gate to PASS.
// Pre-commit bypass: set ARBITER_SKIP_DOCS=true (commit message bypass cannot work pre-commit
// because COMMIT_EDITMSG is written by prepare-commit-msg, which runs AFTER pre-commit).
// This mirrors the CI `docs-check` job so the gate fires identically pre-push. (#356, CANON-01)
import { spawnSync } from 'node:child_process'
import { checkBypass } from './lib/loud-bypass.mjs'

const BYPASS_TOKEN = '[skip-docs]'
const TRIGGER_PREFIXES = ['src/', '__tests__/']
const DOC_PREFIXES = ['docs/']
const DOC_FILES = new Set(['README.md'])

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf-8' })
  return {
    status: r.status ?? 1,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
  }
}

function resolveBase() {
  for (const ref of ['origin/main', 'main']) {
    const verify = git(['rev-parse', '--verify', '--quiet', ref])
    if (verify.status === 0 && verify.stdout) {
      const mb = git(['merge-base', 'HEAD', ref])
      if (mb.status === 0 && mb.stdout) return mb.stdout
      return ref
    }
  }
  return null
}

const base = resolveBase()
const diffRange = base ? `${base}..HEAD` : null

const diff = diffRange
  ? git(['diff', '--name-only', diffRange])
  : { status: 0, stdout: '', stderr: '' }
if (diff.status !== 0) {
  console.error('git diff failed:', diff.stderr)
  process.exit(1)
}
const staged = git(['diff', '--name-only', '--cached'])
const changed = new Set(
  [...diff.stdout.split('\n'), ...staged.stdout.split('\n')].map((s) => s.trim()).filter(Boolean),
)

const hasCode = [...changed].some((f) => TRIGGER_PREFIXES.some((p) => f.startsWith(p)))
const hasDocs = [...changed].some(
  (f) => DOC_PREFIXES.some((p) => f.startsWith(p)) || DOC_FILES.has(f),
)

let bypassed = false
if (diffRange) {
  const log = git(['log', '--format=%B', diffRange])
  if (log.status === 0 && log.stdout.includes(BYPASS_TOKEN)) bypassed = true
}
if (!bypassed) {
  const { bypassed: envBypassed } = checkBypass('ARBITER_SKIP_DOCS', {
    reason: 'docs gate bypass (pre-commit context — commit message bypass unavailable)',
  })
  if (envBypassed) bypassed = true
}

if (hasCode && !hasDocs && !bypassed) {
  console.error('Code changed without documentation update.')
  console.error('Files changed in src/ or __tests__/:')
  for (const f of changed) {
    if (TRIGGER_PREFIXES.some((p) => f.startsWith(p))) console.error('  ' + f)
  }
  console.error(
    `Update docs/ or README.md, add "${BYPASS_TOKEN}" to a commit message, or set ARBITER_SKIP_DOCS=true to bypass.`,
  )
  process.exit(1)
}
process.stdout.write('Docs check passed.\n')
