// SPDX-License-Identifier: Apache-2.0
// M1/#1491 — a file reported "written" by a generator but absent from disk is a
// silent content-loss bug (the class that dropped GLOBAL_INVARIANTS.md). The
// post-write presence check fails hard instead of reporting a phantom success.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertEmittedFilesPresent } from '../../src/commands/init.js'
import type { WriteResult } from '../../src/utils/fs.js'

describe('assertEmittedFilesPresent — post-write integrity guard', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-emit-integrity-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes when every created file is on disk', () => {
    const path = join(dir, 'AGENTS.md')
    writeFileSync(path, 'x')
    const results: WriteResult[] = [{ path, action: 'created' }]
    expect(() => assertEmittedFilesPresent(results)).not.toThrow()
  })

  it('throws when a created file is missing from disk', () => {
    const results: WriteResult[] = [{ path: join(dir, 'GHOST.md'), action: 'created' }]
    expect(() => assertEmittedFilesPresent(results)).toThrow(/Emission integrity check failed/)
    expect(() => assertEmittedFilesPresent(results)).toThrow(/GHOST\.md/)
  })

  it('does NOT flag a not-applicable skip whose file is absent (deliberate non-emission)', () => {
    // GLOBAL_INVARIANTS.md at L1 essential preset: deliberately not emitted, so
    // its absence is correct — must not be a presence-check failure.
    const results: WriteResult[] = [
      { path: join(dir, 'GLOBAL_INVARIANTS.md'), action: 'skipped', reason: 'not-applicable' },
    ]
    expect(() => assertEmittedFilesPresent(results)).not.toThrow()
  })

  it('does NOT flag an ordinary skipIfExists skip whose file is on disk', () => {
    const path = join(dir, 'SECURITY.md')
    writeFileSync(path, 'kept')
    const results: WriteResult[] = [{ path, action: 'skipped' }]
    expect(() => assertEmittedFilesPresent(results)).not.toThrow()
  })

  it('does NOT flag dry-run results (nothing written)', () => {
    const results: WriteResult[] = [{ path: join(dir, 'NOPE.md'), action: 'dry-run' }]
    expect(() => assertEmittedFilesPresent(results)).not.toThrow()
  })
})
