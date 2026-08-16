// SPDX-License-Identifier: Apache-2.0
// #2295: `arbiter update` re-materializes a file the consumer DELETED after arbiter
// had emitted it, and says nothing about having done so.
//
// Measured on pinned, origin-free clones of the bar's own consumers:
//   java (viafera @ b4f7d2ab)       255 manifest-recorded files absent on disk → 254 back after update
//   typescript (coach @ 7c922a81)    21 manifest-recorded files absent on disk →  19 back after update
//   go (haben @ 1fb1e97c)             no manifest at all → nothing restorable
// In none of the three did any warning mention a single restored path.
//
// DIRECTION CHOSEN: loud re-emission, NOT "respect the deletion". Declining every
// manifest-recorded-but-absent path would emit almost nothing on the java consumer
// (255 of its 281 manifest entries are absent at the pin) and would leave the bar's
// own gate-spine assertion with no file to read. `update` therefore keeps writing the
// same bytes; what changes is that the restoration is now named and carried on the
// warnings channel (exit 1), instead of being invisible inside `created`.
//
// The provenance boundary is the point of the fix: a manifest baseline is positive
// evidence arbiter once wrote those bytes to that path. No baseline = never emitted =
// a brand-new template, which must still land silently (AC-3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import {
  loadGeneratedManifest,
  saveGeneratedManifest,
} from '../../src/state/generated-manifest.js'

/** An always-emitted, arbiter-owned file every consumer receives. */
const EMITTED = 'scripts/check-all.mjs'

interface Envelope {
  status?: string
  data?: { restored?: number; created?: number }
  warnings?: string[]
}

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

/**
 * Run `update --json`, capturing the envelope and the exit code the command
 * asks for. `runUpdate` calls `process.exit` for any non-ok outcome, so the
 * code is recovered from the stubbed exit rather than from a return value.
 */
async function updateAndCapture(dir: string): Promise<{ exitCode: number; envelope: Envelope }> {
  const out: string[] = []
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      out.push(String(chunk))
      return true
    })
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
    throw new Error(`__probe_exit__${code ?? 0}`)
  }) as never)
  let exitCode = 0
  try {
    await runUpdate({ dir, github: false, json: true })
  } catch (err) {
    const matched = /__probe_exit__(\d+)/.exec(String(err))
    if (!matched) throw err
    exitCode = Number(matched[1])
  } finally {
    writeSpy.mockRestore()
    exitSpy.mockRestore()
  }
  const line = out.filter((chunk) => chunk.trimStart().startsWith('{')).pop() ?? '{}'
  return { exitCode, envelope: JSON.parse(line) as Envelope }
}

describe('#2295 — update never restores a consumer-deleted file in silence', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2295-restore-'))
    initGit(dir)
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      noVerify: true,
      language: 'typescript',
    })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('sanity: init emits the file and records its baseline; a no-op update is quiet', async () => {
    expect(existsSync(join(dir, EMITTED))).toBe(true)
    expect(loadGeneratedManifest(dir)[EMITTED]).toBeDefined()
    const { exitCode, envelope } = await updateAndCapture(dir)
    expect(exitCode).toBe(0)
    expect(envelope.data?.restored).toBe(0)
  })

  // AC-1 / AC-2 — the red path. The file comes back either way; what must not
  // happen is that it comes back unnamed and on a clean exit code.
  it('AC-1/AC-2: a deleted emitted file is restored LOUDLY — named, counted, exit 1', async () => {
    unlinkSync(join(dir, EMITTED))
    expect(loadGeneratedManifest(dir)[EMITTED]).toBeDefined()

    const { exitCode, envelope } = await updateAndCapture(dir)

    expect(existsSync(join(dir, EMITTED))).toBe(true)
    expect(envelope.data?.restored).toBe(1)
    expect(envelope.status).toBe('warning')
    expect(exitCode).toBe(1)
    expect((envelope.warnings ?? []).join('\n')).toContain(EMITTED)
  })

  // AC-3 — "deleted after having been emitted" is NOT "never existed". A path with
  // no manifest baseline is a brand-new template and must still land silently, or
  // every first run in every consumer turns into a wall of false restorations.
  it('AC-3: a file arbiter has no baseline for is emitted silently, not reported', async () => {
    const manifest = loadGeneratedManifest(dir)
    delete manifest[EMITTED]
    saveGeneratedManifest(dir, manifest)
    unlinkSync(join(dir, EMITTED))

    const { exitCode, envelope } = await updateAndCapture(dir)

    expect(existsSync(join(dir, EMITTED))).toBe(true)
    expect(envelope.data?.restored).toBe(0)
    expect(exitCode).toBe(0)
    expect((envelope.warnings ?? []).join('\n')).not.toContain(EMITTED)
  })

  // The warning is a per-deletion event, not a permanent state: once the file is
  // back and re-baselined, the next update is quiet again.
  it('the restoration warning fires once per deletion, not forever', async () => {
    unlinkSync(join(dir, EMITTED))
    expect((await updateAndCapture(dir)).exitCode).toBe(1)

    const second = await updateAndCapture(dir)
    expect(second.envelope.data?.restored).toBe(0)
    expect(second.exitCode).toBe(0)
  })
})
