#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Root-aware `changeset version` wrapper (#1478).
//
// @manypkg/get-packages (used by changesets) treats `"workspaces": ["website","packages/*"]` as a
// monorepo and enumerates ONLY the workspace members (@arbiter/website) — the ROOT @arbiter/cli is
// returned as `rootPackage`, which `changeset version` does NOT bump. So every @arbiter/cli
// changeset failed assembly ("not in the workspace") and the documented release flow never worked;
// 0.2.0 was cut by manually stripping `workspaces` for the version step.
//
// This automates that workaround safely: temporarily drop `workspaces` so `changeset version` sees
// the single root package, run it, then restore `workspaces` (the `-w @arbiter/website` docs
// scripts need it back) at its original key position. try/finally guarantees restoration even if
// the version step throws. `workspaces` is re-injected into the version-bumped package.json, so the
// version change is preserved.
//
// Usage: node scripts/changeset-version.mjs            (runs `npx changeset version`)
//        node scripts/changeset-version.mjs --dry-run  (strip/restore only, no changeset call)
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { isMainModule } from './lib/run-helpers.mjs'

/** Rebuild an object without `workspaces`, preserving key order. */
export function withoutWorkspaces(pkg) {
  const out = {}
  for (const k of Object.keys(pkg)) if (k !== 'workspaces') out[k] = pkg[k]
  return out
}

/** Re-insert `workspaces` right after `afterKey` (its original predecessor), preserving order. */
export function withWorkspaces(pkg, workspaces, afterKey) {
  const out = {}
  let inserted = false
  for (const k of Object.keys(pkg)) {
    if (k === 'workspaces') continue // never duplicate
    out[k] = pkg[k]
    if (k === afterKey) {
      out.workspaces = workspaces
      inserted = true
    }
  }
  if (!inserted) out.workspaces = workspaces
  return out
}

/**
 * Run `runChangeset` with `workspaces` stripped from the package.json at `pkgPath`, then restore it.
 * Pure orchestration around injected I/O so it is unit-testable without spawning changesets.
 */
export function versionWithRoot({ pkgPath, runChangeset, readFile, writeFile }) {
  const read = readFile ?? ((p) => readFileSync(p, 'utf-8'))
  const write = writeFile ?? ((p, c) => writeFileSync(p, c, 'utf-8'))

  const before = JSON.parse(read(pkgPath))
  const workspaces = before.workspaces
  if (workspaces === undefined) {
    // No workspaces to work around — just run changeset version as-is.
    runChangeset()
    return { stripped: false }
  }
  const keys = Object.keys(before)
  const afterKey = keys[keys.indexOf('workspaces') - 1] ?? null

  write(pkgPath, JSON.stringify(withoutWorkspaces(before), null, 2) + '\n')
  try {
    runChangeset()
  } finally {
    // Re-read (changeset version bumped `version`) and re-inject workspaces at its old position.
    const after = JSON.parse(read(pkgPath))
    write(pkgPath, JSON.stringify(withWorkspaces(after, workspaces, afterKey), null, 2) + '\n')
  }
  return { stripped: true }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = isMainModule(import.meta.url)
if (isMain) {
  const dryRun = process.argv.includes('--dry-run')
  const pkgPath = resolve('package.json')
  const runChangeset = dryRun
    ? () => process.stdout.write('[changeset-version] --dry-run: skipping `changeset version`\n')
    : () => {
        const r = spawnSync('npx', ['changeset', 'version'], { stdio: 'inherit' })
        if (r.status !== 0) {
          throw new Error(`changeset version exited ${r.status ?? 'null'}`)
        }
      }
  try {
    const { stripped } = versionWithRoot({ pkgPath, runChangeset })
    process.stdout.write(
      `[changeset-version] done (root-aware${stripped ? ', workspaces stripped+restored' : ''})\n`,
    )
  } catch (err) {
    process.stderr.write(
      `[changeset-version] error: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
