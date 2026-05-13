import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

describe('generateCheckAll — Rust checkers wiring (#360, CANON-02)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-rust-checkers-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits scripts/checks/check-rust-no-unwrap.mjs for Rust projects', () => {
    generateCheckAll(makeConfig(dir, { language: 'rust', buildTool: 'cargo' }))
    expect(existsSync(join(dir, 'scripts', 'checks', 'check-rust-no-unwrap.mjs'))).toBe(true)
  })

  it('emits scripts/checks/check-rust-no-unsafe.mjs for Rust projects', () => {
    generateCheckAll(makeConfig(dir, { language: 'rust', buildTool: 'cargo' }))
    expect(existsSync(join(dir, 'scripts', 'checks', 'check-rust-no-unsafe.mjs'))).toBe(true)
  })

  it('does NOT emit Rust checkers for non-Rust projects', () => {
    generateCheckAll(makeConfig(dir, { language: 'typescript' }))
    expect(existsSync(join(dir, 'scripts', 'checks', 'check-rust-no-unwrap.mjs'))).toBe(false)
    expect(existsSync(join(dir, 'scripts', 'checks', 'check-rust-no-unsafe.mjs'))).toBe(false)
  })

  it('check-all.mjs invokes both Rust checkers at L1 for Rust projects', () => {
    generateCheckAll(makeConfig(dir, { language: 'rust', buildTool: 'cargo' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(content).toContain('check-rust-no-unwrap.mjs')
    expect(content).toContain('check-rust-no-unsafe.mjs')
  })
})
