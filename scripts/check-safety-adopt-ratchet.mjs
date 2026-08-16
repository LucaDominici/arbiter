#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// T1 (convergence playbook, anti-erosion ratchet): a PROTECTED file that is
// STILL withheld — user-modified, and NOT re-adopted — is exactly the
// silent-erosion case this gate exists to catch. Two classes are protected:
//   safety class  `.claude/hooks/*.mjs`  (e.g. a `stop-dangerous.mjs` fix
//                 shipped upstream while the target repo's modified copy
//                 never received it)
//   gate spine    `scripts/check-all.mjs`, `scripts/lib/*.mjs` (#2109) — the
//                 gate entrypoint and its libs are the delivery vector for
//                 every check arbiter ships later, including this ratchet's
//                 own wiring, so a stale one silently misses new checks
// The two classes are adopted in OPPOSITE directions (#2119): a safety hook is
// a whole file arbiter owns and adopts by default (--no-adopt-safety opts out);
// a gate spine is where the PROJECT wires its own checks, so `arbiter update`
// withholds it and only --adopt-gate-spine overwrites it. Hence two different
// prescriptions below — telling a project with a customized spine to run
// `arbiter update` is either useless (it will not write) or, with the flag,
// destructive. This gate is the monotonic backstop: a divergence can never
// hide, it can only be resolved or explicitly accepted with `arbiter:preserve`.
// Usage: node scripts/check-safety-adopt-ratchet.mjs [--manifest=<path>]

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'

// Keep in sync with PRESERVE_MARKER (arbiter src/utils/fs.ts) — substring match,
// exactly as `writeFile` tests it.
const PRESERVE_MARKER = 'arbiter:preserve'

/** True when the file on disk carries the preserve marker (the documented exception). */
function isPreserveMarked(root, key) {
  try {
    return readFileSync(join(root, key), 'utf8').includes(PRESERVE_MARKER)
  } catch {
    return false
  }
}

function resolveManifestPath(args) {
  const flag = args.find((a) => a.startsWith('--manifest='))
  if (flag) return resolve(flag.slice('--manifest='.length))
  return resolve(process.cwd(), '.arbiter-generated-manifest.json')
}

try {
  const manifestPath = resolveManifestPath(process.argv.slice(2))

  if (!existsSync(manifestPath)) {
    // No manifest yet (pre-first-update project) — nothing to ratchet against.
    process.stdout.write('[safety-adopt-ratchet] no generated manifest yet — SKIP\n')
    process.exit(0)
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    process.stderr.write(`[safety-adopt-ratchet] Failed to parse ${manifestPath}\n`)
    process.exit(1)
  }

  const withheldSafety = Array.isArray(manifest.withheldSafety) ? manifest.withheldSafety : []

  // #2119: accept the documented exception this gate already demands in writing.
  // A preserve-marked file is a deliberate, grep-able, in-file declaration that
  // the divergence is permanent — never silent: it is printed either way.
  const root = dirname(manifestPath)
  const accepted = []
  const unresolved = []
  for (const key of withheldSafety) {
    ;(isPreserveMarked(root, key) ? accepted : unresolved).push(key)
  }

  if (accepted.length > 0) {
    process.stdout.write(
      `[safety-adopt-ratchet] ${accepted.length} protected file(s) accepted as documented ` +
        `exceptions (${PRESERVE_MARKER}): ${accepted.join(', ')}\n`,
    )
  }

  if (unresolved.length === 0) {
    process.stdout.write('[safety-adopt-ratchet] no withheld protected files — OK\n')
    process.exit(0)
  }

  process.stderr.write(
    `[safety-adopt-ratchet] ${unresolved.length} protected file(s) are withheld ` +
      `(user-modified, template fix did NOT land):\n`,
  )
  for (const key of unresolved) {
    process.stderr.write(`  - ${key}\n`)
  }

  // Two classes, two prescriptions. Only hooks are safe to re-adopt blindly.
  const hooks = unresolved.filter((k) => k.startsWith('.claude/hooks/'))
  const spine = unresolved.filter((k) => !k.startsWith('.claude/hooks/'))

  if (hooks.length > 0) {
    process.stderr.write(
      `  Erosion detected in a safety hook (arbiter owns the whole file): run\n` +
        `  \`arbiter update\` (the safety class adopts by default) to re-adopt it, or\n` +
        `  \`arbiter update --adopt-plan\` to preview the diff first.\n`,
    )
  }
  if (spine.length > 0) {
    process.stderr.write(
      `  A customized gate spine is withheld — deliberately, since #2119: that file is where\n` +
        `  THIS project wires its own checks, so \`arbiter update\` will not overwrite it. This\n` +
        `  red is the register of the debt, i.e. the checks arbiter now ships that your gate\n` +
        `  does not run yet. To clear it:\n` +
        `    1. \`arbiter diff\` — see what the current template would add;\n` +
        `    2. wire those checks into your own scripts/check-all.mjs by hand (it is your file);\n` +
        `    3. if the divergence is permanent, mark the file \`${PRESERVE_MARKER}\` — the\n` +
        `       documented exception this gate accepts;\n` +
        `    4. LAST RESORT, DESTRUCTIVE: \`arbiter update --adopt-gate-spine\` replaces your\n` +
        `       gate entrypoint with the template render, deleting the checks you wired into\n` +
        `       it. Preview it with \`--adopt-plan\` before you run it.\n`,
    )
  }
  process.exit(1)
} catch (err) {
  process.stderr.write(
    `[safety-adopt-ratchet] Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
