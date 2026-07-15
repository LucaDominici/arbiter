// SPDX-License-Identifier: Apache-2.0
// #1954 — the isMultiTenant help must not overstate generated machinery.
// The flag only adds a risk-register entry (R-008); it generates NO
// tenant-isolation invariants, data-scoping checks, or tenancy auth code.
// This test locks the honest contract in both the explain command and the
// wizard hint so the overstatement cannot regress.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runExplain } from '../../src/commands/explain.js'

describe('isMultiTenant help honesty (#1954)', () => {
  it('explain describes the flag as descriptive metadata, not generated machinery', () => {
    const result = runExplain('isMultiTenant', {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Descriptive metadata input only')
    expect(result.output).toContain('risk-register entry')
    expect(result.output).not.toMatch(/generates:?\s+tenant-isolation invariants/i)
    expect(result.output).not.toContain('tenancy auth machinery')
  })

  it('wizard hint carries the same honest contract', () => {
    const promptsSource = readFileSync('src/wizard/prompts.ts', 'utf-8')
    expect(promptsSource).toContain('does not generate isolation machinery')
    expect(promptsSource).not.toContain('tenancy auth machinery')
  })
})
