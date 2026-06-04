// SPDX-License-Identifier: Apache-2.0
//
// THE pinpoint proof test (#1206).
//
// Property: a mid-task `arbiter mark` writes a step-cursor {tddPhase, lastAction, nextAction}
// into the single unified phase document. After a simulated `/clear` (a fresh process that has
// only the on-disk document, no conversation memory), `arbiter task resume` must land at the
// EXACT nextAction string — NOT the coarse, hardcoded RECOVERY_TABLE[phase] blurb.
//
// Fail-before/pass-after: against the pre-redesign engine, resume reads `.task-phase` and prints
// RECOVERY_TABLE[phase], which never contains a concrete file path like `src/y.ts`. So the exact
// assertions below are RED before the redesign and GREEN after. This test IS the proof.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runTaskMark, runTaskResume } from '../../src/commands/task.js'
import { readUnifiedState } from '../../src/commands/task-state.js'

/** Capture everything written to process.stdout during fn(). */
function captureStdout(fn: () => void): string {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  // @ts-expect-error — test shim narrows the overloaded signature
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
    return true
  }
  try {
    fn()
  } finally {
    process.stdout.write = orig
  }
  return chunks.join('')
}

describe('arbiter mark + cursor-aware resume — the pinpoint proof (#1206)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('mark writes a step-cursor into the unified document', () => {
    runTaskMark({
      dir,
      taskId: '#1206',
      tddPhase: 'GREEN',
      last: 'wrote failing test for validateEmail',
      next: 'implement validateEmail in src/y.ts',
      digest: 'green: stubbing validateEmail',
    })

    const state = readUnifiedState(dir)
    expect(state).not.toBeNull()
    expect(state?.cursor.tddPhase).toBe('GREEN')
    expect(state?.cursor.lastAction).toBe('wrote failing test for validateEmail')
    expect(state?.cursor.nextAction).toBe('implement validateEmail in src/y.ts')
  })

  it('mark appends a one-line WIP digest to log.md', () => {
    runTaskMark({
      dir,
      taskId: '#1206',
      next: 'implement validateEmail in src/y.ts',
      digest: 'green: stubbing validateEmail',
    })
    const log = readFileSync(join(dir, '.claude', '.task', 'log.md'), 'utf-8')
    expect(log).toContain('green: stubbing validateEmail')
  })

  it('THE PROOF: after /clear, resume lands at the EXACT nextAction (not RECOVERY_TABLE)', () => {
    // mid-task mark
    runTaskMark({
      dir,
      taskId: '#1206',
      tddPhase: 'GREEN',
      last: 'wrote failing test for validateEmail',
      next: 'implement validateEmail in src/y.ts',
    })

    // simulate /clear: a fresh resume with only the on-disk document
    const out = captureStdout(() => runTaskResume({ dir }))

    // exact next action surfaces — the concrete file path proves it is the cursor,
    // not the generic RECOVERY_TABLE.green ("Make tests pass with minimal implementation.")
    expect(out).toContain('implement validateEmail in src/y.ts')
    expect(out).toContain('src/y.ts')
  })

  it('with no cursor, resume falls back to phase-level recovery guidance', () => {
    // fresh task, no mark → resume must still produce coarse guidance, never crash
    const out = captureStdout(() => runTaskResume({ dir }))
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toContain('src/y.ts')
  })
})
