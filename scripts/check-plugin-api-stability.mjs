#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Plugin API stability gate (#603 / R1.K6).
 *
 * Fails when `src/types/plugin.ts` has any diff vs the base branch unless
 * the `apiVersion` literal also changed in the same diff. Forces a
 * deliberate bump on every breaking interface edit.
 *
 * Detection rules:
 *   - No diff → PASS (silent).
 *   - Diff present AND the diff hunks include a line touching `apiVersion`
 *     (added or removed) → PASS.
 *   - Diff present but `apiVersion` unchanged → FAIL with guidance.
 *
 * Compare base resolution order:
 *   1. $ARBITER_DIFF_BASE (e.g. set by CI to the PR base SHA)
 *   2. origin/main
 *   3. main
 * If none resolve, the gate is skipped with a warning (cannot enforce).
 */
import { spawnSync } from 'node:child_process'

const PLUGIN_TYPES_PATH = 'src/types/plugin.ts'

function git(args) {
  const res = spawnSync('git', args, { encoding: 'utf-8' })
  if (res.status !== 0) {
    return { ok: false, stderr: res.stderr ?? '' }
  }
  return { ok: true, stdout: res.stdout ?? '' }
}

function resolveBase() {
  const envBase = process.env.ARBITER_DIFF_BASE
  if (envBase) return envBase
  for (const ref of ['origin/main', 'main']) {
    const r = git(['rev-parse', '--verify', ref])
    if (r.ok) return ref
  }
  return null
}

const base = resolveBase()
if (!base) {
  console.warn(
    '[plugin-api-stability] no diff base found (set $ARBITER_DIFF_BASE or fetch origin/main); skipping',
  )
  process.exit(0)
}

const diff = git(['diff', `${base}...HEAD`, '--', PLUGIN_TYPES_PATH])
if (!diff.ok) {
  console.warn(
    `[plugin-api-stability] git diff failed: ${diff.stderr.trim() || 'unknown'}; skipping`,
  )
  process.exit(0)
}

if (diff.stdout.trim() === '') {
  // No change to plugin types — gate is silently a pass.
  process.exit(0)
}

const hunks = diff.stdout
  .split('\n')
  .filter(
    (line) =>
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---'),
  )

const apiVersionTouched = hunks.some((line) => /apiVersion\s*:/.test(line))

if (!apiVersionTouched) {
  process.stderr.write(
    `[plugin-api-stability] ${PLUGIN_TYPES_PATH} changed but apiVersion was not bumped.\n` +
      `\n` +
      `Plugin API changes require apiVersion to advance (see docs/PLUGIN-API.md §Bump policy).\n` +
      `Either:\n` +
      `  1. Revert the interface change if it's accidental.\n` +
      `  2. Bump apiVersion in the same commit and ship a migration tool.\n`,
  )
  process.exit(1)
}

process.exit(0)
