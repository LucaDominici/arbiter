// SPDX-License-Identifier: Apache-2.0
//
// #2213: one --json envelope contract across every command that accepts --json,
// error paths included, and no inert --seed flag.
//
// The audit (docs/audit/e2e-campaign-2026-08/area78-results.md, A7-19/A7-9) found
// five incompatible shapes across 10 commands and a --seed flag with no observable
// effect. The canonical envelope already exists — src/utils/json-output.ts
// jsonOutput() — so this pins every command to it rather than inventing a new one.
import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const REPO = resolve(import.meta.dirname, '../..')
const NODE = process.execPath

function run(args: readonly string[], cwd?: string) {
  const result = spawnSync(NODE, [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 120_000,
    ...(cwd !== undefined ? { cwd } : {}),
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 }
}

/** Parse the last non-empty stdout line as the JSON envelope. */
function envelopeOf(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split('\n').filter(Boolean)
  return JSON.parse(lines.at(-1) as string) as Record<string, unknown>
}

function expectEnvelope(payload: Record<string, unknown>): void {
  expect(payload).toHaveProperty('command')
  expect(payload).toHaveProperty('version', '1')
  expect(payload).toHaveProperty('status')
  expect(payload).toHaveProperty('data')
  expect(['ok', 'warning', 'error']).toContain(payload['status'])
}

describe('#2213 — --seed is not inert surface', () => {
  it('is gone from the global --help', () => {
    // Generation is already byte-reproducible with zero RNG in src/, so a seed
    // controls no variance. The honest fix is removal, not inventing an RNG.
    expect(run(['--help']).stdout).not.toContain('--seed')
  })

  it('is gone from the ARBITER_* env-flag registry and the API reference', () => {
    expect(readFileSync(join(REPO, 'src/config/env-registry.ts'), 'utf-8')).not.toContain(
      'ARBITER_SEED',
    )
    expect(readFileSync(join(REPO, 'docs/REFERENCE/api.md'), 'utf-8')).not.toContain('ARBITER_SEED')
  })
})

describe('#2213 — error paths honour --json and carry an E_* code', () => {
  it('review diff --json emits the envelope instead of plain text on failure', () => {
    // A7-19: the failure branch wrote `review diff: FAIL — ...` to stderr and
    // ignored --json entirely; only the success path was enveloped.
    const dir = mkdtempSync(join(tmpdir(), 'arb-2213-review-'))
    try {
      const { stdout, status } = run(['review', 'diff', '--json', '--dir', dir])
      expect(status).not.toBe(0)
      const payload = envelopeOf(stdout)
      expectEnvelope(payload)
      expect(payload['status']).toBe('error')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a malformed arbiter.json under --json yields the envelope with the E_* code', () => {
    // Previously the top-level handler wrote text to stderr and exited 78
    // regardless of --json, so `arbiter explain <code>` was unreachable for
    // any --json consumer.
    const dir = mkdtempSync(join(tmpdir(), 'arb-2213-config-'))
    try {
      writeFileSync(join(dir, 'arbiter.json'), '{ not valid json', 'utf-8')
      const { stdout, status } = run(['update', '--json', '--dir', dir], dir)
      expect(status).not.toBe(0)
      const payload = envelopeOf(stdout)
      expectEnvelope(payload)
      expect(payload['status']).toBe('error')
      expect(String(payload['code'])).toMatch(/^E_/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('#2213 — every --json command emits the one canonical envelope', () => {
  it('settings --json is enveloped, not a bare array', () => {
    const payload = envelopeOf(run(['settings', '--json']).stdout)
    expect(Array.isArray(payload)).toBe(false)
    expectEnvelope(payload)
  })

  it('validate --json is enveloped, not a bare report object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arb-2213-validate-'))
    try {
      const payload = envelopeOf(run(['validate', '--json', '--dir', dir]).stdout)
      expectEnvelope(payload)
      // the domain payload moves under data, it is not lost
      expect(payload['data']).toHaveProperty('stack')
      expect(payload['data']).toHaveProperty('probes')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('obsidian --json is enveloped, not its own contractVersion shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arb-2213-obsidian-'))
    try {
      mkdirSync(join(dir, 'wiki'), { recursive: true })
      const payload = envelopeOf(run(['obsidian', '--validate-only', '--json'], dir).stdout)
      expectEnvelope(payload)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('gold-audit --json nests the untouched engine payload under data', () => {
    const payload = envelopeOf(run(['gold-audit', '--json'], REPO).stdout)
    expectEnvelope(payload)
    expect(payload['data']).toHaveProperty('level')
    expect(payload['data']).toHaveProperty('checks')
  })
})
