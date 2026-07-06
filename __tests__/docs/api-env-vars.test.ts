// SPDX-License-Identifier: Apache-2.0
// Test guard for #807 — ARBITER_* env vars documented in docs/REFERENCE/api.md.
// Pure node:fs (no shell exec) per INV-12 / CANON-12 (check-no-direct-spawn.mjs hook).
// Paths anchored to repo root via import.meta.url — independent of process.cwd().

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const r = (rel: string) => resolve(ROOT, rel)

const API_MD_PATH = r('docs/REFERENCE/api.md')

describe('docs/REFERENCE/api.md — environment variables section (#807)', () => {
  let content: string

  it('api.md exists', () => {
    expect(existsSync(API_MD_PATH), `api.md not found at ${API_MD_PATH}`).toBe(true)
    content = readFileSync(API_MD_PATH, 'utf8')
  })

  it('contains an "Environment Variables" section heading', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toMatch(/#+\s+Environment Variables/i)
  })

  // Runtime / trace vars
  it('documents ARBITER_RUN_ID', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_RUN_ID')
  })

  it('documents ARBITER_SEED', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_SEED')
  })

  it('documents ARBITER_LOG_LEVEL', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_LOG_LEVEL')
  })

  it('documents ARBITER_LOG_FORMAT', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_LOG_FORMAT')
  })

  it('documents ARBITER_NO_EVIDENCE', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_NO_EVIDENCE')
  })

  it('documents ARBITER_LOCALE', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_LOCALE')
  })

  // Task lifecycle vars
  it('documents ARBITER_SKIP_PLAN_REVIEW', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_SKIP_PLAN_REVIEW')
  })

  it('documents ARBITER_PLAN_BYPASS', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_PLAN_BYPASS')
  })

  it('documents ARBITER_POST_CLEAR', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_POST_CLEAR')
  })

  // Worktrees
  it('documents ARBITER_WORKTREES_DIR', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_WORKTREES_DIR')
  })

  // Probing
  it('documents ARBITER_PROBE_TIMEOUT_MS', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_PROBE_TIMEOUT_MS')
  })

  it('documents ARBITER_BUILD_PROBE_TIMEOUT_MS', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_BUILD_PROBE_TIMEOUT_MS')
  })

  it('documents ARBITER_ALLOW_CHANNEL_DOWNGRADE', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_ALLOW_CHANNEL_DOWNGRADE')
  })

  // Config overrides
  it('documents ARBITER_THRESHOLD__ prefix', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_THRESHOLD__')
  })

  it('documents ARBITER_FEATURE__ prefix', () => {
    if (!content) content = readFileSync(API_MD_PATH, 'utf8')
    expect(content).toContain('ARBITER_FEATURE__')
  })
})
