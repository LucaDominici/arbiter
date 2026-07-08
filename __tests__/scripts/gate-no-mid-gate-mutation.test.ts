// SPDX-License-Identifier: Apache-2.0
// #1807: the L2 gate ('docs:build' check) was mutating tracked files mid-gate
// as an uncommitted side effect (THIRD_PARTY_LICENSES.md, website/governance/
// AGENTS.md) — a task worktree with a drifted mirror or a `npm pack --dry-run`
// invocation (which always runs `prepack` regardless of --dry-run) silently
// rewrote a committed doc. Fixed by (1) making `prepack` verify-only
// (`gen-third-party-licenses.mjs --check`) instead of regenerating, and (2)
// splitting `docs:build` (mutating: syncs AGENTS.md then builds the site) from
// `docs:build:verify` (read-only: build only) and pointing the gate at the
// latter. Drift is still caught — read-only — by the pre-existing
// 'governance mirror sync (#1805)' check.
//
// These are static assertions on this repo's own package.json / check-all.mjs
// source (dogfood-style, mirroring check-self-dogfood.test.ts) rather than a
// full end-to-end gate run: spawning the real website build/npm pack in a
// unit test would be slow and would not exercise anything these string
// assertions don't already pin down deterministically.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8')
}

describe('gate must never mutate tracked files mid-run (#1807)', () => {
  const pkg = JSON.parse(readRepoFile('package.json')) as {
    scripts: Record<string, string>
  }
  const checkAllSrc = readRepoFile('scripts/check-all.mjs')

  it('prepack verifies (--check) instead of regenerating THIRD_PARTY_LICENSES.md', () => {
    expect(pkg.scripts.prepack).toContain('gen-third-party-licenses.mjs --check')
  })

  it('docs:build:verify exists and does NOT sync governance (read-only build)', () => {
    expect(pkg.scripts['docs:build:verify']).toBeDefined()
    expect(pkg.scripts['docs:build:verify']).not.toContain('sync-public-governance')
  })

  it('docs:build (mutating, for humans/deploy) still syncs before building', () => {
    expect(pkg.scripts['docs:build']).toContain('sync-public-governance.mjs')
    expect(pkg.scripts['docs:build']).toContain('build -w @arbiter/website')
  })

  it("check-all.mjs's docs:build gate check invokes the read-only docs:build:verify script", () => {
    const idx = checkAllSrc.indexOf("docsCheck('docs:build'")
    expect(idx).toBeGreaterThan(-1)
    const line = checkAllSrc.slice(idx, idx + 200)
    expect(line).toContain('docs:build:verify')
    expect(line).not.toMatch(/\['run', 'docs:build'\]/)
  })

  it('the governance mirror sync check (#1805) still runs and hard-fails on drift', () => {
    expect(checkAllSrc).toContain('check-governance-mirror-sync.mjs')
  })
})
