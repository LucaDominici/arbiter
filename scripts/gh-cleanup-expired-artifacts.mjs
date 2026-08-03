#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// gh-cleanup-expired-artifacts.mjs — #2058.
//
// Deletes GitHub Actions artifacts that GitHub itself has already marked
// expired (`expired: true`) but has not physically purged. Safety net: this
// repo observed artifacts up to 60+ days past their retention-days cutoff,
// still resident and still counting against the Actions Artifacts storage
// quota — GitHub's own expiry sweep is not reliably reclaiming space here,
// and a stalled sweep silently re-accumulates into another quota-exhaustion
// cascade (every PR/push CI run blocked) with no other symptom until it hits.
//
// Best-effort maintenance, not a gate: graceful-skip (exit 0) on gh missing /
// unauthenticated / offline / no artifacts, and a per-artifact delete failure
// never aborts the sweep — it's counted and reported, not fatal.
//
// Usage: node scripts/gh-cleanup-expired-artifacts.mjs
//   env GH_CLEANUP_DRY_RUN=1   report what would be deleted, delete nothing
//
// Exit codes (INV-53): 0 SKIP/OK (every expected condition — offline, no gh,
// nothing to delete); 2 ERROR (unexpected internal bug — never silently
// swallowed). The nightly job this runs in is standalone and excluded from
// nightly-required's aggregation, so a red exit here never blocks the gate.
import { spawnSync } from 'node:child_process'
import { isMainModule } from './lib/run-helpers.mjs'

// ── Pure logic (unit-tested without live gh) ──────────────────────────────────

/** Parse `id\texpired` TSV rows (as emitted by the artifacts-list jq filter) into expired IDs. */
export function parseExpiredIds(tsv) {
  const ids = []
  for (const line of String(tsv ?? '').split('\n')) {
    const [id, expired] = line.split('\t')
    if (id && id.trim() && expired?.trim() === 'true') ids.push(id.trim())
  }
  return ids
}

// ── Side-effecting helpers (gh / git) ──────────────────────────────────────────

/** Resolve OWNER/REPO from the git `origin` remote URL. Returns null when unknown. */
export function resolveOwnerRepo() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' })
  if (r.status !== 0 || !r.stdout) return null
  const url = r.stdout.trim()
  const m = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) return null
  return `${m[1]}/${m[2]}`
}

/** Returns the expired artifact IDs, or null on any gh failure (offline / no token). */
function listExpiredIds(ownerRepo) {
  const r = spawnSync(
    'gh',
    [
      'api',
      `repos/${ownerRepo}/actions/artifacts`,
      '--paginate',
      '-q',
      '.artifacts[] | [.id, .expired] | @tsv',
    ],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (r.status !== 0) return null
  return parseExpiredIds(r.stdout)
}

function deleteArtifact(ownerRepo, id) {
  const r = spawnSync('gh', ['api', '-X', 'DELETE', `repos/${ownerRepo}/actions/artifacts/${id}`], {
    encoding: 'utf-8',
  })
  return r.status === 0
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function main(exitFn = process.exit) {
  const ownerRepo = resolveOwnerRepo()
  if (!ownerRepo) {
    process.stdout.write(
      'gh-cleanup-expired-artifacts: SKIP — could not resolve OWNER/REPO from git origin (offline?)\n',
    )
    return exitFn(0)
  }

  const ids = listExpiredIds(ownerRepo)
  if (ids === null) {
    process.stdout.write(
      'gh-cleanup-expired-artifacts: SKIP — gh api call failed (gh missing / unauthenticated / offline)\n',
    )
    return exitFn(0)
  }

  if (ids.length === 0) {
    process.stdout.write('gh-cleanup-expired-artifacts: OK — no expired artifacts found\n')
    return exitFn(0)
  }

  if (process.env.GH_CLEANUP_DRY_RUN === '1') {
    process.stdout.write(
      `gh-cleanup-expired-artifacts: DRY RUN — would delete ${ids.length} expired artifact(s)\n`,
    )
    return exitFn(0)
  }

  let deleted = 0
  let failed = 0
  for (const id of ids) {
    if (deleteArtifact(ownerRepo, id)) deleted++
    else failed++
  }

  process.stdout.write(
    `gh-cleanup-expired-artifacts: OK — deleted ${deleted}/${ids.length} expired artifact(s)` +
      (failed > 0 ? ` (${failed} delete call(s) failed, non-fatal)\n` : '\n'),
  )
  return exitFn(0)
}

// Only run main when invoked as CLI (not imported in tests).
if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (err) {
    // Every EXPECTED failure mode (offline, no gh, unauthenticated, nothing to
    // delete) is handled inside main() itself via exitFn(0) — this catch only
    // ever fires on a genuinely unexpected internal bug, which must surface
    // loudly rather than silently pass as green housekeeping.
    process.stderr.write(
      `gh-cleanup-expired-artifacts: ERROR — ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}
