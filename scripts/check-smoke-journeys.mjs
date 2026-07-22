#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-137 enforcement. Reads smoke-journeys.json at repo root; asserts the declared
// CATALOG:   login/CRUD/authz acceptance floor is COVERED — every `required` journey must have
// CATALOG:   ≥1 matching spec (glob-based, OR semantics). Reuses INV-124's algorithm but with
// CATALOG:   INV-126's fail-closed default: applicability is archetype-computed, so a journey
// CATALOG:   applicable to the archetype is `required` (absent status ⇒ required, never silently
// CATALOG:   n/a). `n/a` needs a rationale ≥20 chars; all-n/a is a hard fail. A whole archetype
// CATALOG:   with no interactive journeys declares applicable:false ⇒ SKIP (like INV-126
// CATALOG:   required:false). SKIP when manifest absent. Boundary: file PRESENCE only — assertion
// CATALOG:   quality is INV-118, and CI execution is the render-smoke/e2e lane's job. Because
// CATALOG:   applicability is genuine (archetype-computed), a wired-but-dead CI job can never be
// CATALOG:   laundered into a legitimate `n/a` here.
// Exit codes (INV-53): 0=PASS/SKIP, 1=policy violation, 2=schema/walk/path-traversal error
// Usage: node scripts/check-smoke-journeys.mjs [--help]
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { globMatch, validateGlob, walkRepo } from './lib/glob-walk.mjs'

const ROOT = resolve(process.cwd())
const MANIFEST_PATH = join(ROOT, 'smoke-journeys.json')
const ARBITER_PATH = join(ROOT, 'arbiter.json')
const REASON_MIN_LEN = 20

const HELP = `Usage: node scripts/check-smoke-journeys.mjs [--help]

Enforces that every declared smoke journey in smoke-journeys.json is COVERED by at
least one real spec file — the login/CRUD/authz acceptance floor (INV-137).

Rules:
  applicable:false   — SKIP (archetype has no interactive login/CRUD/authz journeys).
  status:"required"  — at least one glob must match ≥1 file in the repo tree.
                       OR semantics: passes if ANY glob matches. Absent status ⇒ required
                       (fail-closed: a journey applicable to the archetype is never silently n/a).
  status:"n/a"       — must carry a rationale ≥${REASON_MIN_LEN} chars (auditable, genuine
                       non-applicability only — NOT a "the CI job is dead" escape hatch).
  All n/a            — exit 1 (a fully-skipped floor defeats the gate).

SKIP:
  When smoke-journeys.json is absent (e.g. non-governed projects), gate exits 0.
  Re-init with arbiter init to generate the manifest.

Exit codes:
  0 — pass or SKIP (manifest absent / applicable:false)
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
    process.stdout.write('[check-smoke-journeys] SKIP — smoke-journeys.json not found\n')
    process.exit(0)
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch (err) {
    process.stderr.write(`[check-smoke-journeys] ERROR — invalid JSON: ${err.message}\n`)
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
          `[check-smoke-journeys] ERROR — cannot read arbiter.json: ${err instanceof Error ? err.message : String(err)}\n`,
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
          `[check-smoke-journeys] FAIL — arbiter.json is malformed (${err instanceof Error ? err.message : String(err)}); ` +
            `cannot verify archetype — fix the file or run arbiter update to regenerate\n`,
        )
        process.exit(1)
      }
      if (arbiter.archetype && manifest.archetype && arbiter.archetype !== manifest.archetype) {
        process.stderr.write(
          `[check-smoke-journeys] FAIL — manifest generated for archetype ${manifest.archetype} ` +
            `but arbiter.json declares ${arbiter.archetype} — run arbiter update to regenerate\n`,
        )
        process.exit(1)
      }
    }
  }

  // Applicability SKIP (INV-126 precedent): an archetype with no interactive login/CRUD/authz
  // journeys declares applicable:false. Checked BEFORE the all-n/a / rationale guards so a
  // legitimately non-applicable archetype never trips them. Only an EXPLICIT false skips —
  // an absent flag is fail-closed (falls through to the journeys checks).
  if (manifest.applicable === false) {
    process.stdout.write(
      '[check-smoke-journeys] SKIP — applicable:false (archetype has no interactive smoke journeys)\n',
    )
    process.exit(0)
  }

  if (!Array.isArray(manifest.journeys)) {
    process.stderr.write(
      '[check-smoke-journeys] ERROR — manifest.journeys must be an array (schema error)\n',
    )
    process.exit(2)
  }

  // Collect all repo files once
  const allFiles = walkRepo(ROOT)

  let violations = 0
  let naCount = 0
  const totalJourneys = manifest.journeys.length

  for (const journey of manifest.journeys) {
    const id = typeof journey.id === 'string' ? journey.id : '?'
    const name = typeof journey.name === 'string' ? journey.name : id
    // Fail-closed default: only an explicit "n/a" is n/a; anything else (incl. an absent
    // status) is REQUIRED — a journey applicable to the archetype cannot be silently skipped.
    const status = journey.status === 'n/a' ? 'n/a' : 'required'

    if (status === 'n/a') {
      naCount++
      const rationale = typeof journey.rationale === 'string' ? journey.rationale.trim() : ''
      if (rationale.length < REASON_MIN_LEN) {
        process.stderr.write(
          `[check-smoke-journeys] FAIL — journey ${id} (${name}) is n/a but rationale is ` +
            `${rationale.length} chars (min ${REASON_MIN_LEN}): "${rationale}"\n`,
        )
        violations++
      }
      continue
    }

    const globs = Array.isArray(journey.globs) ? journey.globs : []
    if (globs.length === 0) {
      process.stderr.write(
        `[check-smoke-journeys] FAIL — required journey ${id} (${name}) has no glob patterns ` +
          `— add patterns or mark as n/a with rationale\n`,
      )
      violations++
      continue
    }

    // Validate globs for path traversal
    for (const g of globs) {
      if (!validateGlob(g)) {
        process.stderr.write(
          `[check-smoke-journeys] ERROR — glob "${g}" in journey ${id} contains path traversal ` +
            `or is absolute — only relative, non-traversal globs are allowed\n`,
        )
        process.exit(2)
      }
    }

    // OR semantics: passes if ANY glob matches at least one file
    const found = globs.some((g) => globCount(g, allFiles) > 0)
    if (!found) {
      process.stderr.write(
        `[check-smoke-journeys] FAIL — journey ${id} (${name}) declared but empty ` +
          `— no files matched: ${globs.join(', ')}\n`,
      )
      violations++
    }
  }

  // All-n/a hard fail
  if (naCount > 0 && naCount === totalJourneys) {
    process.stderr.write(
      `[check-smoke-journeys] FAIL — all ${totalJourneys} declared journey(s) are n/a — ` +
        `a fully-skipped floor defeats the gate\n`,
    )
    process.exit(1)
  }

  if (violations > 0) {
    process.stderr.write(`[check-smoke-journeys] FAIL — ${violations} violation(s) found\n`)
    process.exit(1)
  }

  process.stdout.write(`[check-smoke-journeys] OK — ${totalJourneys} journey(s) verified\n`)
  process.exit(0)
}

try {
  await main()
} catch (err) {
  process.stderr.write(`[check-smoke-journeys] ERROR — unexpected: ${err.message}\n`)
  process.exit(2)
}
