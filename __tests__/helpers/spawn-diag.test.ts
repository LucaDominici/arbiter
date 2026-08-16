// SPDX-License-Identifier: Apache-2.0
// #2282: a signal-killed child must be self-diagnosing.
import { describe, it, expect } from 'vitest'
import { describeSpawnResult, type SpawnFailureFields } from './spawn-diag.js'

describe('describeSpawnResult (#2282)', () => {
  // The exact shape observed on the red run: status null, stderr empty. If the
  // description does not name the signal, the next occurrence is again undiagnosable.
  it('names the signal when a child was killed rather than exiting', () => {
    const killed: SpawnFailureFields = { stderr: '', signal: 'SIGKILL', error: undefined }
    expect(describeSpawnResult(killed)).toContain('SIGKILL')
  })

  it('names the spawn error when the child never started', () => {
    const failed: SpawnFailureFields = {
      stderr: '',
      signal: null,
      error: new Error('spawn ENOENT'),
    }
    expect(describeSpawnResult(failed)).toContain('ENOENT')
  })

  it('still carries stderr when the child exited normally with output', () => {
    const noisy: SpawnFailureFields = { stderr: 'boom', signal: null, error: undefined }
    expect(describeSpawnResult(noisy)).toContain('boom')
  })
})
