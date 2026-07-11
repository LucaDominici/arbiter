// SPDX-License-Identifier: Apache-2.0
// #1908 — the generated PR-fast `security-early-fail` job must scope gitleaks
// to `--log-opts="HEAD"`, not the checkout's default all-refs scan.
//
// `actions/checkout@...` runs with `fetch-depth: 0` in this job, which fetches
// every remote branch's history into the object DB. Without `--log-opts`,
// `gitleaks detect` walks ALL reachable refs, so an unrelated, unmerged
// branch's leaked-looking commit fails the Security gate for every other PR
// regardless of relevance. Scoping to `--log-opts="HEAD"` still walks this
// ref's FULL history (no depth lost) — it just stops other branches'
// commits from contaminating this scan. The nightly `gitleaks-history` job
// intentionally keeps `--all --full-history` as the deep, cross-branch net.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(overrides: Record<string, unknown> = {}): string {
  return renderTemplate('github/workflows/01-pr-fast.yml.ejs', {
    ...makeConfig('/tmp/test', overrides),
  } as unknown as Record<string, unknown>)
}

/** Extract the full multi-line `run:` block of the "Gitleaks secrets scan" step. */
function gitleaksRunBlock(out: string): string {
  const match = out.match(/gitleaks detect --source \.[\s\S]*?--exit-code 1 --redact/)
  if (!match) throw new Error('gitleaks detect invocation not found in rendered output')
  return match[0]
}

describe('01-pr-fast.yml.ejs security-early-fail gitleaks scan is scoped to HEAD (#1908)', () => {
  it('invokes gitleaks detect with --log-opts="HEAD", not the default all-refs scan', () => {
    const out = render()
    const runBlock = gitleaksRunBlock(out)
    expect(runBlock).toContain('--log-opts="HEAD"')
  })

  it('gitleaks step is gated on enableSecurityScanning (absent when scanning disabled)', () => {
    const out = render({ enableSecurityScanning: false, governanceLevel: 'L1' })
    expect(out).not.toContain('gitleaks detect')
  })
})
