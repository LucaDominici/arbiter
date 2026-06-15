// SPDX-License-Identifier: Apache-2.0
// RED phase (#1407 / #1408 INV-129): a downstream consumer version of the
// repo-hygiene gate must be emitted and wired into the generated check-all.mjs at
// L1, so governed target projects inherit the data/binary-file guard.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderCheck(overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-no-tracked-artifacts.mjs.ejs', data)
}
function renderCheckAll(overrides: Record<string, unknown> = {}): string {
  const data = makeConfig('/tmp/test', overrides as never) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-all.mjs.ejs', data)
}

describe('scripts/check-no-tracked-artifacts.mjs.ejs — downstream consumer gate (#1407)', () => {
  it('renders an executable node gate with a shebang and INV-53 exit codes', () => {
    const content = renderCheck()
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(content).toContain('process.exit(2)')
    expect(content).toContain('git')
  })

  it('detects data/state file globs', () => {
    const content = renderCheck()
    expect(content).toContain('*.sqlite')
    expect(content).toContain('*.db')
  })

  it('detects compiled binaries by magic bytes (ELF/Mach-O/PE)', () => {
    const content = renderCheck()
    // ELF magic 0x7f 0x45 0x4c 0x46
    expect(content).toContain('0x7f')
    expect(content).toContain('0x45')
  })

  it('ships an allowlist for intentional binary fixtures', () => {
    const content = renderCheck()
    expect(content.toLowerCase()).toContain('fixtures')
  })

  it('is wired into the generated check-all.mjs at L1 (typescript)', () => {
    const content = renderCheckAll({ language: 'typescript', governanceLevel: 'L1' })
    expect(content).toContain('check-no-tracked-artifacts.mjs')
  })

  it('is wired into the generated check-all.mjs for a go project', () => {
    const content = renderCheckAll({ language: 'go', governanceLevel: 'L1' })
    expect(content).toContain('check-no-tracked-artifacts.mjs')
  })
})
