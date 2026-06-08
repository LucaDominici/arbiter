// SPDX-License-Identifier: Apache-2.0
// #1242 — Docs-Evo 3/5: consolidate KEEP-CORE into ~12 files + gate updates + INV-108 retag.
// These tests assert the content-preserving merge result + same-PR gate updates against the
// ACTUAL repo state (not mocks): targets exist with content from every merged source, the
// merged-away originals are gone, CANONICAL_PATHS aliases redirect old paths, and the STRIDE
// gate is repointed to the new GOVERNANCE.md home.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve('.')
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8')
const has = (p: string): boolean => existsSync(resolve(ROOT, p))

// target → list of [source-path, marker-substring that must survive the merge]
const MERGES: Record<string, Array<[string, string]>> = {
  'docs/architecture/ARCHITECTURE.md': [
    ['docs/architecture/OVERVIEW.md', 'Arbiter generates a multi-layer governance stack'],
    [
      'docs/architecture/CANONICAL-SOURCE-MODEL.md',
      'one canonical governance file, all tool configs as thin overlays',
    ],
    [
      'docs/architecture/TEMPLATE-SYSTEM.md',
      'EJS (Embedded JavaScript) was chosen over Handlebars',
    ],
    [
      'docs/architecture/CONFLICT-RESOLUTION.md',
      'How arbiter handles existing files, merges configuration',
    ],
    [
      'docs/architecture/dual-track-contract.md',
      'Every framework capability ships two tracks simultaneously',
    ],
    ['docs/architecture/evidence-bundle.md', 'An **evidence bundle** is a JSON file stored at'],
    ['docs/architecture/skeleton-governance.md', 'Single SSOT defining the target architecture'],
    ['docs/architecture/README.md', 'Read these in order to understand how arbiter'],
  ],
  'docs/METHOD/ENGINEERING_DEFAULTS.md': [
    [
      'docs/SYSTEM/detector-error-policy.md',
      'All file reads in `src/detectors/` MUST go through the shared helpers',
    ],
    [
      'docs/SYSTEM/FAIL_CLOSED.md',
      'A gate is **fail-closed** when its default reaction to an unrecognised state',
    ],
  ],
  'docs/METHOD/PROCESS.md': [
    ['docs/METHOD/TRACK_MODEL.md', 'Define the work-scope taxonomy used to delimit a task'],
    [
      'docs/SYSTEM/POST_COMMIT_TRACKS.md',
      "Arbiter's `post-commit-check.mjs` hook classifies changed files into tracks",
    ],
    [
      'docs/METHOD/DOC_SEMVER.md',
      'Defines how the `doc_version:` frontmatter field on hand-authored .md docs is',
    ],
    ['docs/rfc/README.md', 'Arbiter uses a lightweight RFC (Request for Comments) process'],
  ],
  'docs/METHOD/TESTING.md': [
    ['docs/TESTING_POLICY.md', 'Authentication flow (login / token refresh)'],
    ['docs/MASTER_TEST_PLAN.md', "Update to match your project's test strategy"],
    ['docs/TEST_TAXONOMY.md', 'test-pyramid-profile-26d'],
    [
      'docs/METHOD/SELF_VALIDATION_PROTOCOL.md',
      'A gate that cannot prove its own semantics is a trust liability',
    ],
    [
      'docs/SYSTEM/E2E-RUNTIMES.md',
      'Arbiter ships five library fixtures under `__tests__/fixtures/real-projects/`',
    ],
  ],
  'docs/GOVERNANCE.md': [
    ['docs/GOVERNANCE/index.md', 'arbiter is governed by the same framework it ships'],
    ['docs/GOVERNANCE/RACI.md', 'claim-verified-governance (INV-90)'],
    [
      'docs/SYSTEM/ID-STABILITY.md',
      'Invariant IDs (e.g., `INV-01`, `INV-42`) are write-once public identifiers',
    ],
    ['docs/METHOD/TAG_TAXONOMY.md', 'Closed vocabulary for the `tags:` frontmatter field'],
    [
      'docs/GOVERNANCE/GOOD-FIRST-ISSUE-POLICY.md',
      'Issues labeled `good first issue` are curated on-ramps',
    ],
  ],
  'docs/CONTRIBUTING.md': [
    ['docs/QUICKSTART.md', 'Five-minute install + first command + first gate run'],
    ['docs/SETUP.md', 'This document covers the equivalent steps for the **arbiter repo itself**'],
    ['docs/install/windows.md', 'arbiter does not support native Win32. Use WSL2'],
    ['docs/CODING_STANDARDS.md', "Update to match your team's conventions"],
    [
      'docs/DEVELOPMENT/GETTING-STARTED.md',
      'extend arbiter with a new language detector or generator',
    ],
    [
      'docs/DEVELOPMENT/CONVENTIONS.md',
      'Coding conventions, naming rules, error handling patterns, and the PR checklist',
    ],
  ],
}

const ALL_SOURCES = Object.values(MERGES).flatMap((arr) => arr.map(([src]) => src))

describe('#1242 KEEP-CORE consolidation — targets exist with merged content', () => {
  for (const [target, sources] of Object.entries(MERGES)) {
    it(`${target} exists`, () => {
      expect(has(target), `${target} must exist`).toBe(true)
    })
    for (const [src, marker] of sources) {
      it(`${target} preserves content from ${src}`, () => {
        const body = read(target)
        expect(body.includes(marker), `${target} must contain marker "${marker}" from ${src}`).toBe(
          true,
        )
      })
    }
  }
})

describe('#1242 merged-away originals are deleted (no duplicate authority)', () => {
  // ENGINEERING_DEFAULTS.md is an existing target (kept) — exclude it from the delete set.
  for (const src of ALL_SOURCES) {
    it(`${src} is deleted`, () => {
      expect(has(src), `${src} must be deleted after merge`).toBe(false)
    })
  }
})

describe('#1242 same-PR gate updates (Law 10)', () => {
  it('CANONICAL_PATHS.md has an alias redirect row for every deleted original', () => {
    const cp = read('docs/METHOD/CANONICAL_PATHS.md')
    for (const src of ALL_SOURCES) {
      expect(cp.includes(src), `CANONICAL_PATHS.md must alias ${src}`).toBe(true)
    }
  })

  it('check-stride-traceability.mjs is repointed off docs/GOVERNANCE/RACI.md to docs/GOVERNANCE.md', () => {
    const gate = read('scripts/check-stride-traceability.mjs')
    expect(
      gate.includes('docs/GOVERNANCE/RACI.md'),
      'stride gate must not read the deleted RACI path',
    ).toBe(false)
    expect(
      gate.includes('docs/GOVERNANCE.md'),
      'stride gate must read the new GOVERNANCE.md home',
    ).toBe(true)
  })
})

describe('#1242 SSOT-core inventory reflects the consolidation', () => {
  it('the 4 new docs/ targets carry an active backbone kind so they stay in the SSOT set', () => {
    for (const target of [
      'docs/architecture/ARCHITECTURE.md',
      'docs/METHOD/PROCESS.md',
      'docs/METHOD/TESTING.md',
      'docs/GOVERNANCE.md',
    ]) {
      const fm = read(target).split('\n---', 2)[0]
      expect(/status:\s*active/.test(fm), `${target} must be status: active`).toBe(true)
      expect(
        /kind\/(ssot|governance|spine|canon|api|setup|method)/.test(fm),
        `${target} must carry a backbone kind/*`,
      ).toBe(true)
    }
  })
})
