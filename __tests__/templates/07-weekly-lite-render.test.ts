// SPDX-License-Identifier: Apache-2.0
// PORT A2 (#1502): 07-weekly-lite is the deep weekly sweep for trunk-solo L3+
// projects (which are excluded from the full 07-weekly / 08-monthly suite). It
// carries dependency freshness, a stale action-pin audit, and a deep-security
// subset (Semgrep SAST + full-history secret scan).
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderWeeklyLite(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/07-weekly-lite.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('07-weekly-lite.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  it.each(STACKS)('$language/$buildTool: workflow name is "Weekly Lite (T5-lite)"', (s) => {
    expect(renderWeeklyLite(s)).toContain('name: Weekly Lite (T5-lite)')
  })

  it.each(STACKS)('$language/$buildTool: no EJS tag leaks', (s) => {
    const rendered = renderWeeklyLite(s)
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('schedule offset (05:00 Sunday) avoids the full 07-weekly (04:00) clash', () => {
    expect(renderWeeklyLite({})).toContain("cron: '0 5 * * 0'")
  })

  it('workflow_dispatch trigger present', () => {
    expect(renderWeeklyLite({})).toContain('workflow_dispatch:')
  })

  it('top-level permissions: contents read + issues write', () => {
    const rendered = renderWeeklyLite({})
    expect(rendered).toContain('contents: read')
    expect(rendered).toContain('issues: write')
  })

  it('concurrency cancel-in-progress is false (no mid-run cancellation)', () => {
    const rendered = renderWeeklyLite({})
    expect(rendered).toContain('group: weekly-lite')
    expect(rendered).toContain('cancel-in-progress: false')
  })

  it.each(['dep-freshness:', 'action-version-audit:', 'deep-security:', 'weekly-lite-required:'])(
    'job %s present',
    (job) => {
      expect(renderWeeklyLite({})).toContain(job)
    },
  )

  it('every job declares timeout-minutes (workflow hardening, INV-95)', () => {
    const rendered = renderWeeklyLite({})
    for (const job of [
      'dep-freshness:',
      'action-version-audit:',
      'deep-security:',
      'weekly-lite-required:',
    ]) {
      const afterHeader = rendered.split(`\n  ${job}`)[1] ?? ''
      const preamble = afterHeader.split('\n    steps:')[0]
      expect(preamble, `${job} must declare timeout-minutes`).toContain('timeout-minutes:')
    }
  })
})

describe('07-weekly-lite.yml.ejs — deep-security subset', () => {
  it('runs Semgrep SAST via the pinned CLI (no unverified third-party action)', () => {
    const rendered = renderWeeklyLite({})
    const sec = rendered.split('deep-security:')[1] ?? ''
    expect(sec).toContain('pip install semgrep')
    expect(sec).toContain('semgrep scan')
    // Semgrep must NOT be wired as a third-party GitHub Action (fabricated-pin lesson)
    expect(rendered).not.toMatch(/uses:\s+\S*semgrep/i)
  })

  it('Semgrep ruleset is configurable via SEMGREP_RULES', () => {
    const rendered = renderWeeklyLite({})
    expect(rendered).toContain('SEMGREP_RULES')
  })

  it('includes a full-history secret scan (gitleaks, fetch-depth 0)', () => {
    const rendered = renderWeeklyLite({})
    const sec = rendered.split('deep-security:')[1] ?? ''
    expect(sec).toContain('fetch-depth: 0')
    expect(sec).toMatch(/gitleaks-action@[0-9a-f]{40}/)
  })

  it('all action refs are 40-hex SHA-pinned (INV-76)', () => {
    const rendered = renderWeeklyLite({ language: 'go', buildTool: 'go' })
    // Mirror check-action-pins USES_PATTERN: a real `uses:` step key (leading
    // whitespace, optional `- `), never a `uses:` substring inside a run-block string.
    const refs = [...rendered.matchAll(/^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([^\s#"']+)/gm)]
    expect(refs.length).toBeGreaterThan(0)
    for (const m of refs) {
      if (m[1].startsWith('.')) continue // local composite action — no pin needed
      expect(m[2], `${m[1]}@${m[2]} must be 40-hex SHA-pinned`).toMatch(/^[0-9a-f]{40}$/)
    }
  })
})

describe('07-weekly-lite.yml.ejs — per-language dep-freshness', () => {
  it('TypeScript: npm outdated', () => {
    expect(renderWeeklyLite({ language: 'typescript', buildTool: 'npm' })).toContain('npm outdated')
  })
  it('Go: go list -u', () => {
    expect(renderWeeklyLite({ language: 'go', buildTool: 'go' })).toContain('go list -u')
  })
  it('Rust: cargo outdated', () => {
    expect(renderWeeklyLite({ language: 'rust', buildTool: 'cargo' })).toContain('cargo outdated')
  })
})

// Same class of bug as _weekly.yml.ejs (weekly's red streak, run 28730540157 et
// al.): the identical BSD-only `date -j` fallback and the same unsynced-label
// crash risk are duplicated in this reusable partial's own stale-pin audit.
describe('07-weekly-lite.yml.ejs — stale-pin-audit portability + label self-heal', () => {
  it('does not use the BSD/macOS-only `date -j` fallback anywhere', () => {
    const rendered = renderWeeklyLite({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).not.toContain('date -j')
    expect(rendered).not.toContain('date -v')
  })

  it('a failed commit-date parse is skipped (continue), not left to crash the job', () => {
    const rendered = renderWeeklyLite({ language: 'typescript', buildTool: 'npm' })
    const idx = rendered.indexOf('PUSHED_EPOCH=')
    expect(idx).toBeGreaterThan(-1)
    const slice = rendered.slice(idx, idx + 300)
    expect(slice).toContain('continue')
  })

  it('"File issue on failure" idempotently creates the weekly-regression label before use', () => {
    const rendered = renderWeeklyLite({ language: 'typescript', buildTool: 'npm' })
    const idx = rendered.indexOf('File issue on failure')
    expect(idx).toBeGreaterThan(-1)
    const slice = rendered.slice(idx, idx + 1100)
    const labelCreateIdx = slice.indexOf('gh label create weekly-regression')
    const issueCreateIdx = slice.indexOf('gh issue create')
    expect(labelCreateIdx).toBeGreaterThan(-1)
    expect(issueCreateIdx).toBeGreaterThan(labelCreateIdx)
    expect(slice.slice(labelCreateIdx, labelCreateIdx + 200)).toContain('|| true')
  })
})
