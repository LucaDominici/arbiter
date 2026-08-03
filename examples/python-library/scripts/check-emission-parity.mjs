#!/usr/bin/env node
// CATALOG: emission parity (#2110) — every file Arbiter recorded as emitted is still on disk.
// CATALOG: runs inside the governed project's OWN gate, so drift surfaces on every run and not
// CATALOG: only when someone happens to run `arbiter update`.
// CATALOG: Needs no Arbiter install: it reads the committed `.arbiter-generated-manifest.json`,
// CATALOG: which carries the sha256 of Arbiter's last render per file. Arbiter is not a
// CATALOG: dependency of the projects it governs, so a check that shelled out to its generators
// CATALOG: would SKIP exactly where it matters — and a gate that skips is a green light with
// CATALOG: nothing behind it.
//
// What FAILS: a recorded file that is GONE. "Never emitted" and "deleted after emission" are
// indistinguishable at runtime without the manifest, and the second one silently removes
// protection while the gate stays green.
//
// What does NOT fail: a recorded file whose content DIVERGED. Divergence is the normal, expected
// state of a governed repo — the project customizes `check-all.mjs`, `AGENTS.md`, its rules — and
// it is already governed at write time by the adopt policy and at read time by
// `check-safety-adopt-ratchet.mjs`. Failing on it would red every real consumer on day one.
// Divergence is reported, counted, and left to those gates.
//
// Exit codes (INV-53): 0 PASS, 1 FAIL (recorded file missing / no provenance record), 2 ERROR.
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const root = process.cwd()
const manifestPath = join(root, '.arbiter-generated-manifest.json')

try {
  const files = readManifest(manifestPath)
  const missing = []
  let diverged = 0
  for (const [key, recorded] of Object.entries(files)) {
    const path = join(root, key)
    if (!existsSync(path)) {
      missing.push(key)
      continue
    }
    if (sha256(path) !== recorded) diverged += 1
  }
  if (diverged > 0) {
    process.stderr.write(
      `[emission-parity] ${diverged} recorded file(s) diverged from Arbiter's last render — ` +
        `expected in a customized project; run \`arbiter diff --withheld\` to review.\n`,
    )
  }
  if (missing.length > 0) {
    for (const key of missing.sort()) {
      process.stderr.write(`[emission-parity] MISSING emitted file ${key}\n`)
    }
    process.stderr.write(
      `[emission-parity] FAIL — ${missing.length} file(s) Arbiter emitted are gone. Restore them ` +
        `(\`arbiter update\`) or, if the removal was deliberate, re-run \`arbiter update\` so the ` +
        `manifest stops claiming them.\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[emission-parity] PASS — ${Object.keys(files).length} emitted file(s) present ` +
      `(${diverged} locally diverged)\n`,
  )
  process.exit(0)
} catch (error) {
  process.stderr.write(
    `[emission-parity] ERROR — ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(2)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// A missing manifest is NOT a pass. It means the repo carries no record of what Arbiter put
// there, so nothing downstream can tell a deleted guard from one that never existed — the
// silent-skip this gate exists to remove. `arbiter update` writes the record.
function readManifest(path) {
  if (!existsSync(path)) {
    process.stderr.write(
      `[emission-parity] FAIL — no .arbiter-generated-manifest.json: this repo has no record of ` +
        `what Arbiter emitted, so a deleted guard is indistinguishable from one never emitted. ` +
        `Run \`arbiter update\` to write the provenance record.\n`,
    )
    process.exit(1)
  }
  const parsed = JSON.parse(readFileSync(path, 'utf-8'))
  if (parsed?.$schemaVersion !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
    throw new Error('.arbiter-generated-manifest.json has an invalid shape')
  }
  return parsed.files
}
