#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-124 enforcement. Reads test-pyramid.json at repo root; fails when a
// CATALOG:   declared `required` level has zero matching test files (glob-based, OR semantics).
// CATALOG:   Requires `n/a` levels to carry a rationale ≥20 chars. Fails if ALL levels
// CATALOG:   are n/a (fully-skipped pyramid defeats the gate). SKIP when manifest absent.
// CATALOG:   Boundary: file PRESENCE only — assertion quality is INV-118 / check-anti-proforma.mjs.
// CATALOG:   Rejected fold-in into check-anti-proforma.mjs (different axis: level coverage vs quality).
// Exit codes: 0=PASS/SKIP, 1=policy violation, 2=schema/walk/path-traversal error
// Usage: node scripts/check-test-pyramid.mjs [--help]
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { globMatch, validateGlob, walkRepo } from './lib/glob-walk.mjs'

const ROOT = resolve(process.cwd())
const MANIFEST_PATH = join(ROOT, 'test-pyramid.json')
const ARBITER_PATH = join(ROOT, 'arbiter.json')
const REASON_MIN_LEN = 20

const HELP = `Usage: node scripts/check-test-pyramid.mjs [--help]

Enforces that every declared test level in test-pyramid.json is populated
with at least one real test file (INV-124).

Rules:
  status:"required"  — at least one glob must match ≥1 file in the repo tree.
                       OR semantics: passes if ANY glob matches.
  status:"n/a"       — must carry a rationale ≥${REASON_MIN_LEN} chars (auditable).
  All n/a            — exit 1 (a fully-skipped pyramid defeats the gate).

SKIP:
  When test-pyramid.json is absent (e.g. non-governed projects), gate exits 0.
  Re-init with arbiter init to generate the manifest.

Exit codes:
  0 — pass or SKIP (manifest absent)
  1 — policy violation
  2 — schema error, walk error, or path-traversal glob detected`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}

function globCount(pattern, allFiles) {
  return allFiles.filter((f) => globMatch(pattern, f)).length
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    process.stdout.write('[check-test-pyramid] SKIP — test-pyramid.json not found\n')
    // #2052: recognized marker so runCheck surfaces SKIP, not PASS, in the gate summary.
    process.stdout.write('[SKIP] test-pyramid.json not found\n')
    process.exit(0)
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch (err) {
    process.stderr.write(`[check-test-pyramid] ERROR — invalid JSON: ${err.message}\n`)
    process.exit(2)
  }

  if (!Array.isArray(manifest.levels)) {
    process.stderr.write(
      '[check-test-pyramid] ERROR — manifest.levels must be an array (schema error)\n',
    )
    process.exit(2)
  }

  // Archetype mismatch guard: stale manifests detectable at gate time.
  // Fail-closed (INV-96): a MISSING arbiter.json (ENOENT race) legitimately skips the
  // guard, but a CORRUPT/unparseable arbiter.json must FAIL — silently skipping the
  // archetype check is exactly when manifest drift is most likely to hide.
  if (existsSync(ARBITER_PATH)) {
    let arbiterRaw
    try {
      arbiterRaw = readFileSync(ARBITER_PATH, 'utf-8')
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        arbiterRaw = undefined // race: file removed between existsSync and read — nothing to compare
      } else {
        process.stderr.write(
          `[check-test-pyramid] ERROR — cannot read arbiter.json: ${err instanceof Error ? err.message : String(err)}\n`,
        )
        process.exit(2)
      }
    }
    if (arbiterRaw !== undefined) {
      let arbiter
      try {
        arbiter = JSON.parse(arbiterRaw)
      } catch (err) {
        process.stderr.write(
          `[check-test-pyramid] FAIL — arbiter.json is malformed (${err instanceof Error ? err.message : String(err)}); ` +
            `cannot verify archetype — fix the file or run arbiter update to regenerate\n`,
        )
        process.exit(1)
      }
      if (arbiter.archetype && manifest.archetype && arbiter.archetype !== manifest.archetype) {
        process.stderr.write(
          `[check-test-pyramid] FAIL — manifest generated for archetype ${manifest.archetype} ` +
            `but arbiter.json declares ${arbiter.archetype} — run arbiter update to regenerate\n`,
        )
        process.exit(1)
      }
    }
  }

  // Collect all repo files once
  const allFiles = walkRepo(ROOT)

  let violations = 0
  let naCount = 0
  const totalLevels = manifest.levels.length

  for (const level of manifest.levels) {
    const id = typeof level.id === 'string' ? level.id : '?'
    const name = typeof level.name === 'string' ? level.name : id
    const status = level.status

    if (status === 'n/a') {
      naCount++
      const rationale = typeof level.rationale === 'string' ? level.rationale.trim() : ''
      if (rationale.length < REASON_MIN_LEN) {
        process.stderr.write(
          `[check-test-pyramid] FAIL — level ${id} (${name}) is n/a but rationale is ` +
            `${rationale.length} chars (min ${REASON_MIN_LEN}): "${rationale}"\n`,
        )
        violations++
      }
      continue
    }

    if (status !== 'required') continue

    const globs = Array.isArray(level.globs) ? level.globs : []
    if (globs.length === 0) {
      process.stderr.write(
        `[check-test-pyramid] FAIL — required level ${id} (${name}) has no glob patterns ` +
          `— add patterns or mark as n/a with rationale\n`,
      )
      violations++
      continue
    }

    // Validate globs for path traversal
    for (const g of globs) {
      if (!validateGlob(g)) {
        process.stderr.write(
          `[check-test-pyramid] ERROR — glob "${g}" in level ${id} contains path traversal ` +
            `or is absolute — only relative, non-traversal globs are allowed\n`,
        )
        process.exit(2)
      }
    }

    // OR semantics: passes if ANY glob matches at least one file
    const found = globs.some((g) => globCount(g, allFiles) > 0)
    if (!found) {
      process.stderr.write(
        `[check-test-pyramid] FAIL — level ${id} (${name}) declared but empty ` +
          `— no files matched: ${globs.join(', ')}\n`,
      )
      violations++
    }
  }

  // All-n/a hard fail
  if (naCount > 0 && naCount === totalLevels) {
    process.stderr.write(
      `[check-test-pyramid] FAIL — all ${totalLevels} declared level(s) are n/a — ` +
        `a fully-skipped pyramid defeats the gate\n`,
    )
    process.exit(1)
  }

  if (violations > 0) {
    process.stderr.write(`[check-test-pyramid] FAIL — ${violations} violation(s) found\n`)
    process.exit(1)
  }

  process.stdout.write(`[check-test-pyramid] OK — ${totalLevels} level(s) verified\n`)
  process.exit(0)
}

try {
  await main()
} catch (err) {
  process.stderr.write(`[check-test-pyramid] ERROR — unexpected: ${err.message}\n`)
  process.exit(2)
}
