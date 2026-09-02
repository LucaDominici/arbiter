// SPDX-License-Identifier: Apache-2.0
//
// #2448 — docs/SEMVER.md's "Breaking changes log" table cited version 1.0.0
// for the GovernanceLevel L1->L4 / $schemaVersion 2->3 change, but arbiter has
// never released a 1.0.0 (CHANGELOG.md has no `## [1.0.0]` heading; the same
// change is documented under the real `## [0.2.0]` entry). Likely cause: the
// doc's own `doc_version: '1.0.0'` frontmatter leaked into the table.
//
// This test IS the pin: it parses CHANGELOG.md's released version headings
// (skipping `## [Unreleased]`) and asserts every version cited in the
// breaking-changes-log table is one of them — mechanically, not by grepping
// for the literal string "0.2.0" — so a future unreleased version can never
// leak into that table again undetected.
//
// One narrow, mechanical exception: a row may cite the single legitimately
// *pending* version — a breaking change already merged but not yet released
// (this repo's changesets queue in `.changeset/*.md` between releases).
// CHANGELOG.md's own intro documents the applicable policy verbatim
// ("pre-1.0: a breaking change bumps the minor"), so that pending version is
// computed mechanically from package.json, not guessed: while the package is
// pre-1.0, it is exactly `major.(minor+1).0`. This is what distinguishes a
// legitimate forward reference (e.g. a `0.6.0` row while package.json is
// `0.5.0`) from the bug this test pins down: a version, like the original
// `1.0.0`, that is neither released nor the one true next version.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const SEMVER_PATH = join(REPO_ROOT, 'docs', 'SEMVER.md')
const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md')
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json')

/** Every released version heading (`## [X.Y.Z]`) in a CHANGELOG.md's raw text, skipping Unreleased. */
export function readReleasedChangelogVersions(changelogRaw: string): string[] {
  const headingRe = /^##\s*\[([^\]]+)\]/gm
  const versions: string[] = []
  for (const m of changelogRaw.matchAll(headingRe)) {
    const version = (m[1] ?? '').trim()
    if (version.toLowerCase() === 'unreleased') continue
    versions.push(version)
  }
  return versions
}

/**
 * First-column version cells of the "Breaking changes log" table in
 * docs/SEMVER.md's raw text. Returns [] if the table is absent.
 */
export function readBreakingLogVersions(semverRaw: string): string[] {
  const lines = semverRaw.split('\n')
  const start = lines.findIndex((l) => /^\*\*Breaking changes log:\*\*/.test(l))
  if (start === -1) return []
  const versions: string[] = []
  let seenHeader = false
  let seenSeparator = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!line.trimStart().startsWith('|')) {
      if (seenSeparator) break // table ended
      continue // blank line between the label and the table
    }
    const firstCell = (line.split('|')[1] ?? '').trim()
    if (!seenHeader) {
      seenHeader = true // header row, e.g. "Version | Change"
      continue
    }
    if (/^:?-+:?$/.test(firstCell)) {
      seenSeparator = true
      continue
    }
    if (firstCell.length > 0) versions.push(firstCell)
  }
  return versions
}

/**
 * The single legitimately-pending version a breaking-changes-log row may cite
 * ahead of release: while `pkgVersion` is pre-1.0 (major === 0), that is
 * `major.(minor+1).0` — this repo's own documented policy for a breaking
 * change ("pre-1.0: a breaking change bumps the minor"). Returns null once
 * the package reaches 1.0.0+, where no such automatic forward reference is
 * safe to assume (a future MAJOR bump is not computable — the exact failure
 * mode this test pins down).
 */
export function computePendingPreOneZeroVersion(pkgVersion: string): string | null {
  const m = /^0\.(\d+)\.\d+/.exec(pkgVersion)
  if (!m) return null
  const minor = Number(m[1])
  return `0.${minor + 1}.0`
}

describe('#2448 — SEMVER.md breaking-changes-log cites only released versions', () => {
  const semverBody = readFileSync(SEMVER_PATH, 'utf-8')
  const changelogBody = readFileSync(CHANGELOG_PATH, 'utf-8')
  const pkgVersion = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')).version as string

  it('the breaking-changes-log table exists and has at least one row', () => {
    const versions = readBreakingLogVersions(semverBody)
    expect(versions.length).toBeGreaterThan(0)
  })

  it('CHANGELOG.md has released version headings to compare against', () => {
    const released = readReleasedChangelogVersions(changelogBody)
    expect(released.length).toBeGreaterThan(0)
  })

  it('every version cited in the breaking-changes-log table is released, or the one legitimate pending version', () => {
    const released = new Set(readReleasedChangelogVersions(changelogBody))
    const pending = computePendingPreOneZeroVersion(pkgVersion)
    const cited = readBreakingLogVersions(semverBody)
    const invalid = cited.filter((v) => !released.has(v) && v !== pending)
    expect(invalid).toEqual([])
  })

  it('does not cite 1.0.0 unless arbiter has actually released a 1.0.0 (#2448 regression)', () => {
    // Asserts the CONDITIONAL, not the premise: "arbiter hasn't released 1.0.0
    // yet" is a fact about today's CHANGELOG.md, not the property under test,
    // and would falsely fail this test the day 1.0.0 is genuinely released
    // (at which point citing it becomes entirely legitimate). Test 3 above
    // already enforces the real rule mechanically; this test only pins the
    // specific #2448 regression shape so it reads directly in a failure report.
    const released = readReleasedChangelogVersions(changelogBody)
    if (released.includes('1.0.0')) return // genuinely released — citing it is fine, not this test's concern
    const cited = readBreakingLogVersions(semverBody)
    expect(cited).not.toContain('1.0.0')
  })
})
