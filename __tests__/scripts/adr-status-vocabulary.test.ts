// SPDX-License-Identifier: Apache-2.0
// #2468 — ADR status vocabulary reconciliation.
//
// scripts/check-doc-style.mjs declares ONE canonical doc-status vocabulary
// (VALID_STATUS). Before this fix, four ADRs carried a non-canonical
// `status: accepted` that only produced a soft warning there while a
// separate consumer had to alias `accepted` back to `active` to make sense
// of it — a vocabulary reconciled by aliasing at the consumer instead of at
// the source. This test asserts the RELATIONSHIP, not today's snapshot:
// every numbered ADR's frontmatter `status` must be a member of the single
// canonical set, and that set must be declared in exactly one place. It
// intentionally never hardcodes an ADR count or filename — it discovers the
// real ADR directory at run time, so it keeps holding as ADRs are added,
// renamed, or removed.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { walkRepo } from '../../scripts/lib/glob-walk.mjs'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const CHECK_DOC_STYLE = join(REPO_ROOT, 'scripts/check-doc-style.mjs')
const ADR_DIR = join(REPO_ROOT, 'docs', 'internal', 'ADR')
const NUMBERED_ADR = /^\d{3}-.+\.md$/

/**
 * Extract the canonical status vocabulary from its single declared source
 * (scripts/check-doc-style.mjs's `VALID_STATUS`). Never hardcode a second,
 * independent copy of the list in this test — that would be exactly the
 * duplication the test itself is asserting does not exist.
 */
function canonicalStatuses(): Set<string> {
  const src = readFileSync(CHECK_DOC_STYLE, 'utf-8')
  const m = /VALID_STATUS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(src)
  if (m === null) {
    throw new Error('VALID_STATUS literal not found in scripts/check-doc-style.mjs')
  }
  return new Set(
    m[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s.length > 0),
  )
}

function frontmatterStatus(text: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  if (fm === null) return null
  const m = /^status:\s*(.+)$/m.exec(fm[1])
  if (m === null) return null
  return m[1].trim().replace(/^['"]|['"]$/g, '')
}

describe('ADR status vocabulary — single canonical source (#2468)', () => {
  // Scope note: #2468 AC-1 reconciles exactly ONE non-canonical value — the `accepted` alias a
  // handful of ADRs drifted onto, distinct from the frontmatter vocabulary's own `active`. Other
  // pre-existing non-canonical values (`proposed`, `superseded`) are a separate, out-of-scope
  // finding (captured via `arbiter note`, not fixed here) — this assertion targets only the
  // `accepted` class the issue names, so it does not widen this task's diff to cover them.
  it('never draws a numbered ADR\'s frontmatter status from the retired "accepted" alias', () => {
    const canonical = canonicalStatuses()
    const files = readdirSync(ADR_DIR).filter((f) => NUMBERED_ADR.test(f))
    // Sanity: the relationship below is vacuous if the directory is ever empty — guard against
    // a silently-passing assertion, without pinning the actual count.
    expect(files.length).toBeGreaterThan(0)

    // Whichever way #2468 resolves the vocabulary — migrate the ADRs, or admit `accepted` into
    // the canonical set — the invariant that must hold afterward is the same: no ADR's status is
    // the string "accepted" while the canonical set does NOT itself contain it (a value the
    // canonical set doesn't recognize is exactly the aliasing-at-the-consumer smell #2468 closes).
    const usingRetiredAlias = files
      .map((f) => ({ f, status: frontmatterStatus(readFileSync(join(ADR_DIR, f), 'utf-8')) }))
      .filter(({ status }) => status === 'accepted' && !canonical.has('accepted'))

    expect(usingRetiredAlias).toEqual([])
  })

  it('declares the canonical status vocabulary literal in exactly one file', () => {
    // A second, independent declaration of the same vocabulary (even spelled identically) is
    // the reconciliation-by-duplication this issue closes off — the next consumer that needs
    // the vocabulary must import/derive it from check-doc-style.mjs, never re-declare it.
    const canonical = [...canonicalStatuses()]
    const literalPattern = new RegExp(
      `new Set\\(\\[\\s*${canonical.map((s) => `['"]${s}['"]`).join('\\s*,\\s*')}\\s*\\]\\)`,
    )

    const declaredIn: string[] = []
    for (const dir of ['scripts', 'src']) {
      const root = join(REPO_ROOT, dir)
      for (const rel of walkRepo(root)) {
        if (!/\.(mjs|ts)$/.test(rel)) continue
        const abs = join(root, rel)
        const text = readFileSync(abs, 'utf-8')
        if (literalPattern.test(text)) declaredIn.push(abs)
      }
    }

    expect(declaredIn).toEqual([CHECK_DOC_STYLE])
  })
})
