#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// check-todo-max-age.mjs — INV-133 (#1456).
//
// A TODO(#NNN) whose LINKED ISSUE was created more than MAX_AGE_DAYS ago FAILS the gate.
// Age is derived from the issue `created_at` ONLY — never from line/blame/git metadata.
// Graceful-skip when gh is missing / token absent / offline: the gate exits 0 (SKIP) and
// NEVER false-fails on a network or auth problem.
//
// Usage: node scripts/check-todo-max-age.mjs [dir...]
//   env TODO_MAX_AGE_DAYS  override the 180-day default
//
// Exit codes (INV-53):
//   0  PASS / SKIP (no over-age TODO, or created_at unresolvable — offline)
//   1  FAIL — one or more linked issues are older than MAX_AGE_DAYS
//   2  ERROR — invocation error
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const DEFAULT_MAX_AGE_DAYS = 180

const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'templates'])
// Capture the issue number from TODO(#NNN) in a comment context.
const TODO_ISSUE = /TODO\(#(\d+)\)/g

// ── Pure logic (unit-tested without live gh) ──────────────────────────────────

/**
 * True when `createdAtIso` is strictly older than `maxAgeDays` relative to `nowMs`.
 * Returns false for an unparseable/empty value — an unknown age never false-fails.
 */
export function isOverAge(createdAtIso, nowMs, maxAgeDays) {
  if (!createdAtIso || typeof createdAtIso !== 'string') return false
  const created = Date.parse(createdAtIso)
  if (Number.isNaN(created)) return false
  const ageDays = (nowMs - created) / (24 * 60 * 60 * 1000)
  return ageDays > maxAgeDays
}

/**
 * Parse every TODO(#NNN) reference out of a file's text.
 * Returns [{ issueNumber, line }] (1-based line numbers).
 */
export function parseTodoIssueRefs(content) {
  const refs = []
  const lines = String(content ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    let m
    TODO_ISSUE.lastIndex = 0
    while ((m = TODO_ISSUE.exec(lines[i])) !== null) {
      refs.push({ issueNumber: Number(m[1]), line: i + 1 })
    }
  }
  return refs
}

/**
 * Classify a list of TODO refs against a {issueNumber → createdAtIso} map.
 *
 * - `skipped: true` when NO ref could be resolved to a created_at (offline / no token):
 *   the caller must treat this as SKIP, never FAIL.
 * - `overAge`: refs whose linked issue is older than `maxAgeDays`. Unresolved issues are
 *   ignored (not failed) as long as at least one was resolved.
 */
export function classifyOverAge(refs, createdAtMap, nowMs, maxAgeDays) {
  let anyResolved = false
  const overAge = []
  for (const ref of refs) {
    const createdAt = createdAtMap.get(ref.issueNumber)
    if (createdAt === undefined || createdAt === '') continue
    anyResolved = true
    if (isOverAge(createdAt, nowMs, maxAgeDays)) overAge.push(ref)
  }
  const skipped = refs.length > 0 && !anyResolved
  return { skipped, overAge }
}

// ── Side-effecting helpers (gh / fs) ──────────────────────────────────────────

/** Resolve OWNER/REPO from the git `origin` remote URL. Returns null when unknown. */
export function resolveOwnerRepo() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' })
  if (r.status !== 0 || !r.stdout) return null
  const url = r.stdout.trim()
  // git@github.com:OWNER/REPO.git  or  https://github.com/OWNER/REPO(.git)
  const m = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) return null
  return `${m[1]}/${m[2]}`
}

/**
 * Fetch the `created_at` for one issue via gh, graceful on any failure.
 * Returns '' (empty) when gh is missing / unauthenticated / offline / issue not found —
 * mirrors the `gh api ... 2>/dev/null || echo ""` pattern, so the caller SKIPs.
 */
function fetchCreatedAt(ownerRepo, issueNumber) {
  const r = spawnSync(
    'gh',
    ['api', `repos/${ownerRepo}/issues/${issueNumber}`, '--jq', '.created_at'],
    { encoding: 'utf-8', env: process.env },
  )
  if (r.status !== 0 || !r.stdout) return ''
  return r.stdout.trim()
}

function scan(dir, baseDir, acc) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      scan(full, baseDir, acc)
    } else if (EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) {
      const content = readFileSync(full, 'utf-8')
      for (const ref of parseTodoIssueRefs(content)) {
        acc.push({ file: relative(baseDir, full), issueNumber: ref.issueNumber, line: ref.line })
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function main(exitFn = process.exit) {
  const maxAgeDays = Number(process.env.TODO_MAX_AGE_DAYS) || DEFAULT_MAX_AGE_DAYS
  const baseDir = process.cwd()
  const scanDirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['src', 'scripts']

  const refs = []
  for (const dir of scanDirs) scan(join(baseDir, dir), baseDir, refs)

  if (refs.length === 0) {
    process.stdout.write('check-todo-max-age: no TODO(#NNN) references — PASS\n')
    return exitFn(0)
  }

  const ownerRepo = resolveOwnerRepo()
  if (!ownerRepo) {
    process.stdout.write(
      'check-todo-max-age: SKIP — could not resolve OWNER/REPO from git origin (offline?)\n',
    )
    return exitFn(0)
  }

  // Cache by issue number to avoid hammering the API / rate limits.
  const createdAtMap = new Map()
  for (const ref of refs) {
    if (createdAtMap.has(ref.issueNumber)) continue
    createdAtMap.set(ref.issueNumber, fetchCreatedAt(ownerRepo, ref.issueNumber))
  }

  const { skipped, overAge } = classifyOverAge(refs, createdAtMap, Date.now(), maxAgeDays)

  if (skipped) {
    process.stdout.write(
      'check-todo-max-age: SKIP — no issue created_at could be resolved (gh missing / token absent / offline)\n',
    )
    return exitFn(0)
  }

  if (overAge.length > 0) {
    process.stdout.write(
      `check-todo-max-age: FAIL — ${overAge.length} TODO(#NNN) link issue(s) older than ${maxAgeDays} days:\n`,
    )
    for (const ref of overAge) {
      process.stdout.write(`  ${ref.file}:${ref.line}  TODO(#${ref.issueNumber})\n`)
    }
    process.stdout.write(
      '  Resolve the linked issue or split the work — an over-age TODO is stale debt.\n',
    )
    return exitFn(1)
  }

  process.stdout.write(
    `check-todo-max-age: PASS — ${createdAtMap.size} linked issue(s) within ${maxAgeDays} days\n`,
  )
  return exitFn(0)
}

// Only run main when invoked as CLI (not imported in tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
