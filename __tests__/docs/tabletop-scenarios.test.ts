// SPDX-License-Identifier: Apache-2.0
// #2429 — doc-asserting test for the tabletop scenario catalogue.
// A catalogue whose "docs the user would read" point at files that do not exist sends the
// tabletop agent chasing phantoms, which is the exact failure class a tabletop exists to
// find. So every cited arbiter-local path is stat'd here.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CATALOGUE = 'docs/internal/METHOD/TABLETOP-SCENARIOS.md'

const EXPECTED_SLUGS = [
  'greenfield-init-ts',
  'brownfield-update-go',
  'ship-one-xs-issue',
  'drain-wave-of-four',
  'pr-red-and-recover',
  'consumer-upgrade-delta',
]

const REQUIRED_FIELDS = [
  '**Slug:**',
  '**Persona:**',
  '**Starting state:**',
  '**Goal:**',
  '**Docs the user would read:**',
  '**Executable probes:**',
  '**Exit criterion:**',
]

function catalogue(): string {
  return readFileSync(CATALOGUE, 'utf-8')
}

/** The `## N. …` scenario blocks, in document order. */
function scenarioBlocks(text: string): string[] {
  return text
    .split(/^## (?=\d+\. )/m)
    .slice(1)
    .map((b) => `## ${b}`)
}

/** The raw text of a scenario block's `**Executable probes:**` field, if present. */
function executableProbesText(block: string): string | null {
  const m = /\*\*Executable probes:\*\*([\s\S]*?)(?=\n- \*\*Exit criterion:\*\*)/.exec(block)
  return m ? m[1] : null
}

/**
 * Repo-relative script/doc paths cited inside a scenario's `Executable probes` field.
 * Filters out CLI invocations (`node dist/cli.js …`), bare flags, and shell commands
 * (`gh pr checks --help`) — those aren't paths this repo tracks and cannot be stat'd.
 * `dist/` is excluded too: it is a build artifact, not a committed source path.
 */
function citedProbePaths(block: string): string[] {
  const text = executableProbesText(block) ?? ''
  const spans = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  return spans.filter((s) => /^(scripts|src|docs|\.claude|__tests__|examples)\//.test(s))
}

/**
 * `{name, language, archetype}` for every `examples/<name>/` that is a materialized
 * (arbiter.json-bearing) generated example — read live from disk, never hardcoded, so
 * this stays true as `examples/` grows or shrinks (#2454).
 */
function materializedExamples(): Array<{ name: string; language: string; archetype: string }> {
  const root = 'examples'
  const out: Array<{ name: string; language: string; archetype: string }> = []
  for (const name of readdirSync(root)) {
    const cfgPath = join(root, name, 'arbiter.json')
    if (!existsSync(cfgPath)) continue
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')) as {
      language?: string
      archetype?: string
    }
    if (cfg.language && cfg.archetype) {
      out.push({ name, language: cfg.language, archetype: cfg.archetype })
    }
  }
  return out
}

describe('tabletop scenario catalogue (#2429)', () => {
  it('exists with the repo frontmatter convention', () => {
    expect(existsSync(CATALOGUE)).toBe(true)
    const text = catalogue()
    expect(text.startsWith('---\n')).toBe(true)
    for (const key of ['title:', 'doc_version:', 'status:', 'last_review:', 'tags:']) {
      expect(text).toContain(key)
    }
  })

  it('declares exactly the six seeded scenarios', () => {
    const blocks = scenarioBlocks(catalogue())
    expect(blocks).toHaveLength(6)
    const slugs = blocks.map((b) => /\*\*Slug:\*\*\s*`([^`]+)`/.exec(b)?.[1])
    expect(slugs).toEqual(EXPECTED_SLUGS)
  })

  it('gives every scenario all seven catalogue fields', () => {
    for (const block of scenarioBlocks(catalogue())) {
      const heading = block.split('\n')[0]
      const missing = REQUIRED_FIELDS.filter((f) => !block.includes(f))
      expect(missing, `${heading} is missing ${missing.join(', ')}`).toEqual([])
    }
  })

  it('cites only arbiter-local doc paths that actually exist', () => {
    let cited = 0
    for (const block of scenarioBlocks(catalogue())) {
      const line = /\*\*Docs the user would read:\*\*(.*)/.exec(block)?.[1] ?? ''
      const paths = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])
      expect(paths.length, `${block.split('\n')[0]} cites no docs`).toBeGreaterThan(0)
      for (const p of paths) {
        cited++
        expect(existsSync(p), `${CATALOGUE} cites a non-existent path: ${p}`).toBe(true)
      }
    }
    expect(cited).toBeGreaterThanOrEqual(6)
  })

  it('is indexed in docs/INDEX.md', () => {
    expect(readFileSync('docs/INDEX.md', 'utf-8')).toContain('METHOD/TABLETOP-SCENARIOS.md')
  })

  // #2445 — a probe that answers a different question than its scenario's exit criterion
  // is worse than no probe: it manufactures a green result exactly where the doc exists to
  // create real confidence. Mechanically proving "this probe is plausibly about this axis"
  // in general is not attempted here (there is no reliable, generalizable text signal for
  // it — see the two scripts' own header comments this fix reasoned from). What IS asserted
  // mechanically, for every current and future scenario: every probe path a scenario cites
  // must actually exist. On top of that, two regression pins guard the specific mismatches
  // #2445 found and fixed from silently regressing.
  it('cites only probe paths that exist', () => {
    let checked = 0
    for (const block of scenarioBlocks(catalogue())) {
      const heading = block.split('\n')[0]
      for (const p of citedProbePaths(block)) {
        checked++
        expect(existsSync(p), `${heading} cites a probe path that does not exist: ${p}`).toBe(true)
      }
    }
    // At least the two probes this fix relies on (below) must have been walked.
    expect(checked).toBeGreaterThan(0)
  })

  it("never leaves a scenario's probes field empty (a probeless scenario must say so)", () => {
    for (const block of scenarioBlocks(catalogue())) {
      const heading = block.split('\n')[0]
      const text = executableProbesText(block)
      expect(text, `${heading} missing Executable probes field`).toBeTruthy()
      expect(
        (text ?? '').trim().length,
        `${heading} has an empty Executable probes field`,
      ).toBeGreaterThan(0)
    }
  })

  it('regression: drain-wave-of-four cites the disjointness mechanism, not the dispatch-matrix one (#2445)', () => {
    const wave = scenarioBlocks(catalogue()).find((b) => b.includes('`drain-wave-of-four`'))
    expect(wave, 'drain-wave-of-four scenario not found').toBeTruthy()
    const probes = executableProbesText(wave ?? '') ?? ''
    // check-agent-dispatch.mjs verifies the review-dispatch matrix (tier->vertical floor,
    // model-diversity, refutation-skeptic counts) — a different axis from this scenario's
    // exit criterion (disjoint file-sets, worktree isolation, single-wave-PR shape).
    expect(probes).not.toContain('check-agent-dispatch.mjs')
    // check-touched-vs-manifest.mjs is the harvest-time mechanism behind the disjoint-
    // file-set precondition (touched files must stay inside a group's declared manifest).
    expect(probes).toContain('check-touched-vs-manifest.mjs')
  })

  it('regression: consumer-upgrade-delta cites the deprecation-window mechanism, not the API-snapshot one (#2445)', () => {
    const upgrade = scenarioBlocks(catalogue()).find((b) => b.includes('`consumer-upgrade-delta`'))
    expect(upgrade, 'consumer-upgrade-delta scenario not found').toBeTruthy()
    const probes = executableProbesText(upgrade ?? '') ?? ''
    // check-api-snapshot.mjs verifies arbiter's own internal TS export surface
    // (plugin/invariants/compatibility types) hasn't drifted — unrelated to whether a
    // listed deprecation carries a version+removal window or the upgrade preview's skip
    // set matches semver-preserved files.
    expect(probes).not.toContain('check-api-snapshot.mjs')
    expect(probes).toContain('check-deprecations.mjs')
  })

  // #2454 — a probe that diffs against "the materialized <Language> example" is only
  // honest when a materialized example for that language actually exists AND, for a
  // scenario shaped around a *service* persona, that example is not silently a `library`
  // archetype standing in for it. Asserts the RELATIONSHIP (claimed diff target ⇄ what is
  // actually materialized), read live from `examples/*/arbiter.json` — never today's
  // example names or count — so a future probe naming a target that doesn't exist (the
  // exact defect #2454 fixed) goes red here again, for any language or archetype.
  it('a "service" scenario\'s "materialized <Language> example" diff either matches a non-library archetype or states the gap explicitly (#2454)', () => {
    const examples = materializedExamples()
    expect(
      examples.length,
      'no materialized examples found under examples/ at all',
    ).toBeGreaterThan(0)

    for (const block of scenarioBlocks(catalogue())) {
      const heading = block.split('\n')[0]
      // Scope: only scenarios whose own persona/starting-state is explicitly about a
      // "service" (the shape that implies backend-web-db, not library).
      if (!/\bservice\b/i.test(block)) continue

      const probes = executableProbesText(block) ?? ''
      const claim = /materialized (\w+) example/i.exec(probes)
      if (!claim) continue

      const language = claim[1].toLowerCase()
      const forLanguage = examples.filter((e) => e.language === language)
      expect(
        forLanguage.length,
        `${heading}: probe diffs against "the materialized ${claim[1]} example" but no ` +
          `${language} example is materialized under examples/`,
      ).toBeGreaterThan(0)

      const onlyLibrary = forLanguage.every((e) => e.archetype === 'library')
      if (onlyLibrary) {
        expect(
          block,
          `${heading}: persona is about a "service" but every materialized ${language} ` +
            `example is archetype "library" — the archetype mismatch (no example-drift ` +
            `coverage for the service-shaped archetype) must be stated as an explicit gap`,
        ).toMatch(/coverage gap|no .*example-drift coverage/i)
      }
    }
  })
})
