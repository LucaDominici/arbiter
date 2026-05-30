// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Unit tests for selective gating logic (ADR-053)
// Tests the computeSkipped() function exported from scripts/check-all.mjs
// and the resetSelectiveState() export for test isolation

let computeSkipped: (
  changedFiles: string[],
  registry: Array<{ name: string; affects: string[] }>,
  blacklist: string[],
) => Set<string>
let resetSelectiveState: () => void

beforeEach(async () => {
  // Dynamic import for test isolation via resetSelectiveState
  const mod = await import('../../scripts/check-all.mjs?t=' + Date.now())
  computeSkipped = (mod as { computeSkipped: typeof computeSkipped }).computeSkipped
  resetSelectiveState = (mod as { resetSelectiveState: typeof resetSelectiveState })
    .resetSelectiveState
  if (resetSelectiveState) resetSelectiveState()
})

afterEach(() => {
  if (resetSelectiveState) resetSelectiveState()
})

describe('computeSkipped — blacklist forces full gate', () => {
  const registry = [
    { name: 'typecheck', affects: ['src/**/*.ts'] },
    { name: 'unit tests', affects: ['src/**', '__tests__/**'] },
    { name: 'lint', affects: ['src/**', '__tests__/**'] },
  ]
  const blacklist = ['tsconfig*.json', 'package.json', 'pnpm-lock.yaml', 'src/utils/**']

  it('tsconfig.json change → full gate (empty skipped set)', () => {
    const skipped = computeSkipped(['tsconfig.json'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('package.json change → full gate', () => {
    const skipped = computeSkipped(['package.json'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('src/utils/run-cli.ts change → full gate (blacklisted path)', () => {
    const skipped = computeSkipped(['src/utils/run-cli.ts'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('pnpm-lock.yaml change → full gate', () => {
    const skipped = computeSkipped(['pnpm-lock.yaml'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })
})

describe('computeSkipped — unrelated file skips checks', () => {
  const registry = [
    { name: 'typecheck', affects: ['src/**/*.ts'] },
    { name: 'docs', affects: ['docs/**'] },
  ]
  const blacklist = ['tsconfig*.json']

  it('docs-only change → typecheck skipped', () => {
    const skipped = computeSkipped(['docs/ADR/053.md'], registry, blacklist)
    expect(skipped.has('typecheck')).toBe(true)
  })

  it('docs-only change → docs NOT skipped (affects docs/**)', () => {
    const skipped = computeSkipped(['docs/ADR/053.md'], registry, blacklist)
    expect(skipped.has('docs')).toBe(false)
  })

  it('src change → typecheck NOT skipped', () => {
    const skipped = computeSkipped(['src/foo.ts'], registry, blacklist)
    expect(skipped.has('typecheck')).toBe(false)
  })
})

describe('computeSkipped — checks not in registry always run', () => {
  const registry = [{ name: 'typecheck', affects: ['src/**/*.ts'] }]
  const blacklist = ['tsconfig*.json']

  it('check not in registry is never skipped', () => {
    const skipped = computeSkipped(['docs/foo.md'], registry, blacklist)
    expect(skipped.has('lint')).toBe(false)
    expect(skipped.has('unit tests')).toBe(false)
  })
})

describe('computeSkipped — mixed changes', () => {
  const registry = [
    { name: 'typecheck', affects: ['src/**/*.ts'] },
    { name: 'docs', affects: ['docs/**'] },
  ]
  const blacklist = ['tsconfig*.json', 'package.json']

  it('mixed TS + docs change → typecheck NOT skipped', () => {
    const skipped = computeSkipped(['src/foo.ts', 'docs/ADR/053.md'], registry, blacklist)
    expect(skipped.has('typecheck')).toBe(false)
  })

  it('docs-only + blacklist change → full gate (empty skipped set)', () => {
    const skipped = computeSkipped(['docs/ADR/053.md', 'package.json'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })
})

describe('computeSkipped — input validation', () => {
  const registry: Array<{ name: string; affects: string[] }> = []
  const blacklist: string[] = []

  it('absolute paths are rejected → full gate', () => {
    const skipped = computeSkipped(['/etc/passwd'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('../ escape paths are rejected → full gate', () => {
    const skipped = computeSkipped(['../other-repo/secret.ts'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('list over 500 files → full gate', () => {
    const files = Array.from({ length: 501 }, (_, i) => `src/file${i}.ts`)
    const skipped = computeSkipped(files, registry, blacklist)
    expect(skipped.size).toBe(0)
  })
})
