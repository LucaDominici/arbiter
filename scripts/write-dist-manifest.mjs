#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// #2089 — record dist/.src-manifest.json (content hash of the watched src/
// subtrees) as the LAST step of `npm run build`. checkDistFresh() compares this
// stored hash against current src/ content instead of filesystem mtimes, so a
// cache-restored dist/ (CI) or an mtime-bumped-but-unchanged src file (local)
// no longer false-positives as stale (issue #2089). Deliberately NOT folded into
// build-kit.mjs: build-kit reruns after the CI cache-restore and would
// regenerate the manifest against current src/, making the freshness guard
// vacuous. Root is derived from this file's location (not process.cwd) so the
// step is invariant to where the build is invoked from.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeDistManifest } from './lib/dist-staleness.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

try {
  const hash = writeDistManifest(repoRoot)
  process.stderr.write(
    `write-dist-manifest: dist/.src-manifest.json srcHash=${hash.slice(0, 12)}…\n`,
  )
} catch (err) {
  process.stderr.write(
    `write-dist-manifest: FAILED — ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
