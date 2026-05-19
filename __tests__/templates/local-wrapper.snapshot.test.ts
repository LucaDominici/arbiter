import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateLocalWrapper } from '../../src/generators/local-wrapper.js'
import { generateEnvTemplate } from '../../src/generators/env-template.js'
import { makeConfig } from '../helpers.js'

const GNU_MAKE_PATTERNS = [
  { pattern: /:=/, label: 'GNU immediate assignment (:=)' },
  { pattern: /\?=/, label: 'GNU conditional assignment (?=)' },
  { pattern: /\bifeq\b/, label: 'GNU ifeq conditional' },
  { pattern: /\bifdef\b/, label: 'GNU ifdef conditional' },
  { pattern: /\$\(shell\b/, label: 'GNU $(shell ...) function' },
  { pattern: /\$\(wildcard\b/, label: 'GNU $(wildcard ...) function' },
  { pattern: /\.SECONDEXPANSION/, label: 'GNU .SECONDEXPANSION special target' },
  { pattern: /^[^#\n]*%[^:]*:/m, label: 'GNU % pattern rule' },
  { pattern: /^\S[^:]*:\s+[\w-][\w-]*\s*[:+?!]?=/m, label: 'GNU target-specific variable' },
]

// Template coverage: local-wrapper/Makefile.ejs, local-wrapper/run.sh.ejs, local-wrapper/.env.example.ejs

describe('local-wrapper/Makefile.ejs — POSIX compliance (#879, W3)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-makefile-posix-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rendered Makefile contains no GNU-only make constructs', () => {
    generateLocalWrapper(makeConfig(dir))
    const content = readFileSync(join(dir, 'Makefile'), 'utf-8')

    for (const { pattern, label } of GNU_MAKE_PATTERNS) {
      expect(content, `Makefile uses forbidden GNU construct: ${label}`).not.toMatch(pattern)
    }
  })

  it('rendered Makefile declares .PHONY for all targets', () => {
    generateLocalWrapper(makeConfig(dir))
    const content = readFileSync(join(dir, 'Makefile'), 'utf-8')
    expect(content).toMatch(/^\.PHONY:/m)
    for (const target of ['help', 'check', 'gate', 'ci', 'full', 'evidence', 'clean']) {
      expect(content, `Makefile .PHONY missing: ${target}`).toContain(target)
    }
  })
})

describe('local-wrapper/run.sh.ejs — POSIX shebang (#879, W3)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-runsh-posix-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('run.sh uses POSIX shebang (#!/bin/sh, not bash)', () => {
    generateLocalWrapper(makeConfig(dir))
    const content = readFileSync(join(dir, 'run.sh'), 'utf-8')
    expect(content).toMatch(/^#!\/bin\/sh\s*$/m)
  })

  it('run.sh delegates to check-all.mjs', () => {
    generateLocalWrapper(makeConfig(dir))
    const content = readFileSync(join(dir, 'run.sh'), 'utf-8')
    expect(content).toContain('check-all.mjs')
  })
})

describe('local-wrapper/.env.example.ejs — env var reference (#879, W3)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-env-example-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('.env.example contains ARBITER_LEVEL', () => {
    generateEnvTemplate(makeConfig(dir))
    const content = readFileSync(join(dir, '.env.example'), 'utf-8')
    expect(content).toContain('ARBITER_LEVEL')
  })

  it('.env.example contains ARBITER_EVIDENCE_DIR', () => {
    generateEnvTemplate(makeConfig(dir))
    const content = readFileSync(join(dir, '.env.example'), 'utf-8')
    expect(content).toContain('ARBITER_EVIDENCE_DIR')
  })
})
