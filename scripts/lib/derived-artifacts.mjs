// SPDX-License-Identifier: Apache-2.0
// scripts/lib/derived-artifacts.mjs — DERIVED_ARTIFACTS: every scripts/check-all.mjs
// gate that validates generated/derived state (docs, wiki, dashboards, pin
// mirrors) by running a generator in read-only/--check mode. `name` MUST match
// a runCheck(...) name string in check-all.mjs — enforced by
// __tests__/scripts/lib/derived-artifacts.test.ts — so this list can't
// silently drift from the gate it describes.
//
// Consumed by scripts/regen.mjs (`npm run regen`) to run every writeCmd
// before the gate, so stale derived state never causes a gate failure
// unrelated to the change actually being worked on (gate-throughput audit,
// 2026-07-23: check-wiki-lint failing on a stale docs/technical-debt.md
// mirror because nobody re-ran gen-wiki.mjs).
//
// Deliberately excluded even though they fit the check/generator shape:
//   - check-api-snapshot.mjs --regen: rewrites the ENTIRE gated artifact (the
//     public API surface), which exists specifically to force human
//     acknowledgment of a breaking change (PR_BODY "BREAKING API CHANGE:").
//     Auto-regen would make that gate vacuous — excluded on purpose.
//   - check-self-dogfood.mjs --update-divergences / check-script-cohesion.mjs
//     --update-baseline / check-fail-closed-audit.mjs --update-baseline:
//     human-reviewed pin/baseline updates, not mechanical mirrors.
//   - check-ssot-core.mjs (INV-108) / check-adr-index.mjs (README listing):
//     their generator-derived failure mode is already covered transitively —
//     both read output that the 'ssot core index (#1100)' / 'adr digest
//     (INV-107)' rows below already regenerate — so no separate row needed.

export const DERIVED_ARTIFACTS = [
  {
    name: 'third-party licenses',
    checkCmd: ['node', 'scripts/gen-third-party-licenses.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-third-party-licenses.mjs'],
  },
  {
    name: 'wiki lint (INV-116)',
    checkCmd: ['node', 'scripts/check-wiki-lint.mjs'],
    writeCmd: ['node', 'scripts/gen-wiki.mjs'],
  },
  {
    name: 'doc index (#1102)',
    checkCmd: ['node', 'scripts/gen-doc-index.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-doc-index.mjs'],
  },
  {
    name: 'llms.txt drift (#1721)',
    checkCmd: ['node', 'scripts/gen-llms-txt.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-llms-txt.mjs'],
  },
  {
    name: 'status dashboard',
    checkCmd: ['node', 'scripts/gen-status.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-status.mjs'],
  },
  {
    name: 'derived pages (#1838)',
    checkCmd: ['node', 'scripts/gen-derived-pages.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-derived-pages.mjs'],
  },
  {
    name: 'gap register',
    checkCmd: ['node', 'scripts/gen-gap.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-gap.mjs'],
  },
  {
    name: 'ssot core index (#1100)',
    checkCmd: ['node', 'scripts/gen-ssot-core.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-ssot-core.mjs'],
  },
  {
    name: 'adr digest (INV-107)',
    checkCmd: ['node', 'scripts/gen-adr-readme.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-adr-readme.mjs'],
  },
  {
    name: 'cli ref parity (INV-111)',
    checkCmd: ['node', 'scripts/gen-cli-ref.mjs', '--check'],
    writeCmd: ['node', 'scripts/gen-cli-ref.mjs'],
  },
  {
    name: 'feature matrix (INV-112)',
    checkCmd: ['node', 'scripts/check-feature-matrix.mjs', '--check'],
    writeCmd: ['node', 'scripts/check-feature-matrix.mjs', '--write'],
  },
  {
    name: 'action pin parity',
    checkCmd: ['node', 'scripts/sync-action-pins.mjs', '--check'],
    writeCmd: ['node', 'scripts/sync-action-pins.mjs'],
  },
  {
    name: 'governance mirror sync (#1805)',
    checkCmd: ['node', 'scripts/check-governance-mirror-sync.mjs'],
    writeCmd: ['node', 'scripts/sync-public-governance.mjs'],
  },
]
