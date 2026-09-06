#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Parity gate for packages/kernel/hooks/ (#2548) — the committed kernel-plugin
// CATALOG: hooks were, in practice, hand-maintained: build-kernel-plugin.mjs was wired
// CATALOG: into nothing (no npm script, no gate step) and nothing compared its output
// CATALOG: to what got committed. Regenerating from a clean state produced 475
// CATALOG: insertions / 78 deletions across 6 files (#2548) before this gate existed.
// CATALOG: Rejected folding into check-self-dogfood.mjs (the closest existing model,
// CATALOG: INV-45's template<->materialized comparator): that script's corpus is
// CATALOG: TEMPLATE_ROOTS (src/templates/claude/ -> .claude, src/templates/ship/ ->
// CATALOG: .arbiter/ship) plus a REQUIRED_RAW_HOOKS allowlist, and it reimplements EJS
// CATALOG: rendering + prettier normalization inline for that corpus. packages/kernel/hooks/
// CATALOG: is a THIRD family: a *subset* of the same templates rendered with a neutral
// CATALOG: fixed config (not arbiter's own arbiter.json), via its OWN entrypoint
// CATALOG: (build-kernel-plugin.mjs) that already does its own EJS render + prettier
// CATALOG: --write. Reimplementing that render a third time here (a fourth TEMPLATE_ROOTS
// CATALOG: entry) would risk exactly the #1877/#1894 drift class: two independent
// CATALOG: renderers of one output, with only one of them policed. Instead this gate
// CATALOG: shells out to build-kernel-plugin.mjs itself (via its `--out=` flag) so the
// CATALOG: comparison and the real emission path can never diverge — then diffs that
// CATALOG: temp dir against the committed one with the byte-level scripts/lib/dir-diff.mjs
// CATALOG: helper (shared with regenerate-examples.mjs's identical drift shape).
//
// Never trusts the generator's own console output as a signal — build-kernel-plugin.mjs's
// progress lines and prettier's own "(unchanged)" per-file status (prettier's reformat
// verdict, not a generator self-report) are NOT read here; only the generator's exit
// code (infra signal) and a real post-hoc byte diff (content signal) are.
//
// Never writes into packages/kernel/hooks/ or anywhere else in the working tree: the
// generator is invoked with `--out=<mkdtemp'd dir>`, removed in a finally block.
//
// Exit codes per INV-53: 0 PASS (no drift) / 1 FAIL (drift found, files named) /
// 2 ERROR (dist/ missing or stale, or build-kernel-plugin.mjs itself failed to run).
//
// Usage: node scripts/check-kernel-plugin-parity.mjs [--dir <path>]
//   --dir <path>  compare against <path> instead of packages/kernel/hooks/ (used by the
//                 CANON-24 flip-proof fixture in scripts/lib/guard-flip-registry.mjs to
//                 exercise this gate against a synthetic bad/clean fixture without ever
//                 touching the real committed tree).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { checkDistFresh } from './lib/dist-staleness.mjs'
import { diffDirs } from './lib/dir-diff.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_COMMITTED_DIR = join(ROOT, 'packages', 'kernel', 'hooks')
const GENERATOR = join(ROOT, 'scripts', 'build-kernel-plugin.mjs')

function parseArgs(argv) {
  const idx = argv.indexOf('--dir')
  const committedDir = idx !== -1 && argv[idx + 1] ? resolve(argv[idx + 1]) : DEFAULT_COMMITTED_DIR
  return { committedDir }
}

/**
 * Render the generator into `freshDir` via `--out=` (a child process — see the file
 * header on why this is never an in-process import). Returns `{ ok: true }` or
 * `{ ok: false, message }`; never throws on a non-zero generator exit (that is an
 * ERROR result for the caller to report, not an exception to propagate).
 */
function renderFresh(freshDir) {
  const gen = spawnSync(process.execPath, [GENERATOR, `--out=${freshDir}`], {
    cwd: ROOT,
    encoding: 'utf-8',
  })
  if (gen.status === 0) return { ok: true }
  return {
    ok: false,
    message:
      `[kernel-plugin-parity] ERROR — build-kernel-plugin.mjs exited ${gen.status ?? 'null'}; ` +
      `run \`node scripts/build-kernel-plugin.mjs\` directly to see why:\n` +
      `${gen.stdout ?? ''}${gen.stderr ?? ''}\n`,
  }
}

/** Prints the FAIL banner + every removed/added/changed file, one line each. */
function reportDrift(removed, added, changed) {
  process.stderr.write(
    '[kernel-plugin-parity] FAIL — packages/kernel/hooks/ has drifted from build-kernel-plugin.mjs:\n',
  )
  for (const f of removed)
    process.stderr.write(`  - extra (committed, no longer generated): ${f}\n`)
  for (const f of added) process.stderr.write(`  - missing (generated, not committed): ${f}\n`)
  for (const f of changed) process.stderr.write(`  - changed: ${f}\n`)
  process.stderr.write(
    '\n  Run `npm run kernel-plugin:build` and review + commit the diff (#2548).\n',
  )
}

/**
 * Run the parity check. Returns the INV-53 exit code (0/1/2); never calls
 * process.exit itself so it stays unit-testable. Exported for tests.
 */
export function checkKernelPluginParity(argv = process.argv.slice(2)) {
  const { committedDir } = parseArgs(argv)

  // Fail-closed BEFORE spawning the generator: a missing/stale dist/ would make
  // build-kernel-plugin.mjs render from stale compiled templates, which would
  // report either a false PASS (both sides stale in the same way) or a false FAIL
  // (spurious drift against a stale render) — an infra problem, not a content one.
  const distFreshness = checkDistFresh(ROOT)
  if (!distFreshness.fresh) {
    process.stderr.write(`[kernel-plugin-parity] ERROR — ${distFreshness.reason}\n`)
    return 2
  }

  const freshDir = mkdtempSync(join(tmpdir(), 'kernel-plugin-parity-'))
  try {
    const rendered = renderFresh(freshDir)
    if (!rendered.ok) {
      process.stderr.write(rendered.message)
      return 2
    }

    const { removed, added, changed } = diffDirs(committedDir, freshDir)
    if (removed.length === 0 && added.length === 0 && changed.length === 0) {
      process.stdout.write(
        '[kernel-plugin-parity] PASS — packages/kernel/hooks/ matches build-kernel-plugin.mjs output\n',
      )
      return 0
    }

    reportDrift(removed, added, changed)
    return 1
  } finally {
    rmSync(freshDir, { recursive: true, force: true })
  }
}

// INV-96 (fail-closed): an uncaught exception here (a bad mkdtemp, an unreadable file
// diffDirs did not expect, checkDistFresh's own read throwing) must never fall through
// to Node's default uncaught-exception exit — this is caught explicitly and mapped to
// exit 2 (ERROR), NEVER 0. A parity gate that swallows its own crash into a PASS is
// exactly the vacuous-gate class CANON-24 exists to rule out (#2548).
if (isMainModule(import.meta.url)) {
  try {
    process.exit(checkKernelPluginParity())
  } catch (err) {
    process.stderr.write(
      `[kernel-plugin-parity] FATAL — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    process.exit(2)
  }
}
