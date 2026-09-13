// SPDX-License-Identifier: Apache-2.0
// #2666 AC2, hermetic proof: scripts/check-all.local.mjs is a project-local
// file no template emits, so it is invisible to BOTH `arbiter update
// --adopt-gate-spine` and `arbiter diff --withheld` — not "not withheld
// because it's pristine" (the gate-spine default), but genuinely never a
// candidate at all, because no generator ever produces it (mirrors the
// runInit + runUpdate hermetic pattern in update-adopt.test.ts).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit as runInitCommand } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { runDiff } from '../../src/commands/diff.js'

const LOCAL_SLOT = 'scripts/check-all.local.mjs'

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

function runInit(options: Parameters<typeof runInitCommand>[0]) {
  return runInitCommand({ ...options, language: 'typescript' })
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

describe('#2666 AC2 — scripts/check-all.local.mjs survives adopt-gate-spine and diff untouched', () => {
  let dir: string
  const localContent = "export const checks = [{ name: 'x', cmd: ['true'], tier: 'L1' }];\n"

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-local-slot-adopt-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
    writeFileSync(join(dir, LOCAL_SLOT), localContent)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is byte-identical after `arbiter update --adopt-gate-spine` (the destructive opt-in)', async () => {
    const before = readFileSync(join(dir, LOCAL_SLOT), 'utf-8')
    expect(sha256(before)).toBe(sha256(localContent))

    await runUpdate({ dir, github: false, adoptGateSpine: true })

    const after = readFileSync(join(dir, LOCAL_SLOT), 'utf-8')
    expect(after).toBe(before)
    expect(sha256(after)).toBe(sha256(localContent))
  })

  it('is byte-identical after the broadest `arbiter update --adopt`', async () => {
    await runUpdate({ dir, github: false, adopt: true })
    expect(readFileSync(join(dir, LOCAL_SLOT), 'utf-8')).toBe(localContent)
  })

  it('never appears in `arbiter diff` output at all — not even in the withheld section', () => {
    const writes: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((s: unknown) => {
      writes.push(String(s))
      return true
    }) as typeof process.stdout.write
    try {
      runDiff({ dir, github: false })
    } finally {
      process.stdout.write = origWrite
    }
    expect(writes.some((w) => w.includes(LOCAL_SLOT))).toBe(false)
  })

  it('never appears in `arbiter diff --withheld` (the focused reconciliation view)', () => {
    const writes: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((s: unknown) => {
      writes.push(String(s))
      return true
    }) as typeof process.stdout.write
    try {
      runDiff({ dir, github: false, withheld: true })
    } finally {
      process.stdout.write = origWrite
    }
    expect(writes.some((w) => w.includes(LOCAL_SLOT))).toBe(false)
  })

  it('is never written into .arbiter-generated-manifest.json (no generator emits it)', async () => {
    await runUpdate({ dir, github: false, adoptGateSpine: true })
    const manifestPath = join(dir, '.arbiter-generated-manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(manifest, LOCAL_SLOT)).toBe(false)
  })
})
