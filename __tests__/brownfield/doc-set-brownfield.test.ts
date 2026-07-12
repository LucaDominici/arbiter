// SPDX-License-Identifier: Apache-2.0
// CANON-11: brownfield coverage for src/generators/doc-set.ts (T3, gold-doc-tranches-t3-t5.md
// §1) — re-running the skeleton generator on an existing project must respect skipIfExists: a
// user-edited skeleton is preserved verbatim, and only an untouched engine banner stub is
// upgraded in place. See __tests__/generators/doc-set.test.ts for the full unit-test suite this
// complements (right-sizing, tier variants, unbound reporting, --plan/--apply).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGoldKit } from '../../src/generators/gold-kit.js'
import { generateDocSetSkeletons } from '../../src/generators/doc-set.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
  generateGoldKit(makeConfig(dir))
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('brownfield: generateDocSetSkeletons re-init on an existing project', () => {
  it('preserves a hand-edited skeleton verbatim on re-run (skipIfExists)', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const path = join(dir, 'docs', 'GOVERNANCE.md')
    const handEdited = readFileSync(path, 'utf-8').replace(
      '## Decision rights',
      '## Decision rights\n\nThe tech lead decides architecture; everyone else proposes.',
    )
    writeFileSync(path, handEdited)

    generateDocSetSkeletons(makeConfig(dir))
    expect(readFileSync(path, 'utf-8')).toBe(handEdited)
  })

  it('re-running the generator on its own output is idempotent (brownfield re-init is a no-op)', () => {
    const path = join(dir, 'docs', 'GOVERNANCE.md')
    generateDocSetSkeletons(makeConfig(dir))
    const firstPass = readFileSync(path, 'utf-8')
    expect(firstPass).not.toContain('STUB — fill me in')

    generateDocSetSkeletons(makeConfig(dir))
    expect(readFileSync(path, 'utf-8')).toBe(firstPass)
    expect(existsSync(path)).toBe(true)
  })

  it('brownfield --plan (dryRun) never mutates an already-scaffolded project', () => {
    generateDocSetSkeletons(makeConfig(dir))
    const before = readFileSync(join(dir, 'docs', 'GLOSSARY.md'), 'utf-8')
    generateDocSetSkeletons(makeConfig(dir), { dryRun: true })
    expect(readFileSync(join(dir, 'docs', 'GLOSSARY.md'), 'utf-8')).toBe(before)
  })
})
