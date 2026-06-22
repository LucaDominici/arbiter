// SPDX-License-Identifier: Apache-2.0
// Regression guard (#1491, release-readiness gap "gcp-sha-actionpin"): a SHA pin can be
// 40-hex (so check-action-pins.mjs passes) yet still be FABRICATED — a string that is not a
// real commit object in the upstream repo. Such a pin ships to every generated project and
// fails at CI runtime with "Unable to resolve action … unable to find version".
//
// The sigstore/cosign-installer pin was fabricated: `d7d6bc7722e7ddfa5e8ede2a605eb4c14fa96b50`
// is a 404 in the upstream repo, while the genuine v3.8.1 commit is
// `d7d6bc7722e3daa8354c50bcb52f4837da5e9b6a` (verified against the GitHub git/tags API). This
// test is a STATIC, offline ratchet: no committed source/workflow/template may reference the
// known-fabricated SHA, and the genuine commit must be the one in use.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..')

// The fabricated 40-hex string that passed the format-only gate but is not a real commit.
const FABRICATED_COSIGN_SHA = 'd7d6bc7722e7ddfa5e8ede2a605eb4c14fa96b50'
// The genuine sigstore/cosign-installer v3.8.1 commit object.
const GENUINE_COSIGN_SHA = 'd7d6bc7722e3daa8354c50bcb52f4837da5e9b6a'

// git-tracked files only — never node_modules/dist artifacts the test should not police, and
// never the frozen .arbiter/evidence/tdd/*.json snapshots (historical records, not live config).
function trackedFiles(): string[] {
  const res = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' })
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr}`)
  return (
    res.stdout
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .filter((f) => !f.startsWith('.arbiter/evidence/'))
      // This test file legitimately names the fabricated SHA to detect it — exclude itself.
      .filter((f) => f !== '__tests__/scripts/action-pin-authenticity.test.ts')
  )
}

describe('action-pin authenticity (#1491 — fabricated SHA ratchet)', () => {
  it('no tracked file references the fabricated cosign-installer SHA', () => {
    const offenders: string[] = []
    for (const f of trackedFiles()) {
      let content: string
      try {
        content = readFileSync(resolve(ROOT, f), 'utf-8')
      } catch {
        continue
      }
      if (content.includes(FABRICATED_COSIGN_SHA)) offenders.push(f)
    }
    expect(offenders, `fabricated cosign-installer SHA found in:\n${offenders.join('\n')}`).toEqual(
      [],
    )
  })

  it('cosign-installer is pinned to the genuine v3.8.1 commit where it appears', () => {
    // Every cosign-installer ref in source/workflow/template files must use the genuine commit.
    const cosignRefs: { file: string; ref: string }[] = []
    const re = /sigstore\/cosign-installer@([0-9a-f]{40})/g
    for (const f of trackedFiles()) {
      let content: string
      try {
        content = readFileSync(resolve(ROOT, f), 'utf-8')
      } catch {
        continue
      }
      for (const m of content.matchAll(re)) cosignRefs.push({ file: f, ref: m[1] })
    }
    // The pin is used in arbiter's own release pipeline + shipped deploy templates, so it must
    // exist somewhere; a future refactor that drops it entirely should update this expectation.
    expect(cosignRefs.length).toBeGreaterThan(0)
    for (const { file, ref } of cosignRefs) {
      expect(ref, `${file} pins cosign-installer@${ref}, expected ${GENUINE_COSIGN_SHA}`).toBe(
        GENUINE_COSIGN_SHA,
      )
    }
  })
})
