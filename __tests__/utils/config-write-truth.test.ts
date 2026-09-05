// SPDX-License-Identifier: Apache-2.0
//
// #2541: `saveConfig`, `saveConfigAndSnapshot` and `writeSnapshot` each call the
// shared `writeFile` primitive and used to discard the returned `WriteResult`
// entirely — a withheld write (e.g. the on-disk file carries the `arbiter:preserve`
// marker, or any future reason `writeFile` declines to land the bytes) was silently
// reported as success, so `arbiter init`/`update`/`configure` could claim success
// while `arbiter.json`/`.arbiter-generated.json` were left unchanged on disk.
//
// This file isolates that write-truth contract with a mocked `writeFile` so the
// withheld/benign-skip branches are exercised deterministically, independent of
// what actually triggers `withheld` in `src/utils/fs.ts` today — mirrors
// `__tests__/evidence/tdd-write-truth.test.ts` (#2533).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../src/utils/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/fs.js')>()
  return {
    ...actual,
    writeFile: vi.fn(),
  }
})

vi.mock('../../src/utils/file-lock.js', () => ({
  acquireLock: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
}))

import { writeFile, type WriteResult } from '../../src/utils/fs.js'
import { saveConfig, saveConfigAndSnapshot, writeSnapshot } from '../../src/utils/config.js'
import { defaultConfig } from '../helpers/default-config.js'

const mockWriteFile = vi.mocked(writeFile)

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-config-write-truth-'))
}

const withheldResult = (path: string): WriteResult => ({
  path,
  action: 'skipped',
  withheld: true,
})

const benignSkipResult = (path: string): WriteResult => ({
  path,
  action: 'skipped',
})

const createdResult = (path: string): WriteResult => ({
  path,
  action: 'created',
})

describe('saveConfig() — write-truth contract (#2541)', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    mockWriteFile.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('throws when the underlying arbiter.json write is withheld', async () => {
    mockWriteFile.mockReturnValue(withheldResult(join(dir, 'arbiter.json')))
    await expect(saveConfig(dir, defaultConfig())).rejects.toThrow(/withheld/i)
  })

  it('does not throw when the write is a benign identical-content skip', async () => {
    mockWriteFile.mockReturnValue(benignSkipResult(join(dir, 'arbiter.json')))
    await expect(saveConfig(dir, defaultConfig())).resolves.not.toThrow()
  })

  it('does not throw on a normal created/replaced write', async () => {
    mockWriteFile.mockReturnValue(createdResult(join(dir, 'arbiter.json')))
    await expect(saveConfig(dir, defaultConfig())).resolves.not.toThrow()
  })

  // Part B verdict: arbiter.json is never generator-emitted (no `src/generators/*.ts`
  // targets it — confirmed by grep, and documented in
  // docs/REFERENCE/file-stability.md as the primary user config whose own
  // load→mutate→save merge logic already protects user edits, outside the
  // generator/manifest/preserve-marker system entirely). It is therefore exempt
  // from the `arbiter:preserve` marker, the same class as TDD evidence/task-state.
  it('writes arbiter.json with skipPreserveCheck (exempt: never a generator-emitted target)', async () => {
    mockWriteFile.mockReturnValue(createdResult(join(dir, 'arbiter.json')))
    await saveConfig(dir, defaultConfig())
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('arbiter.json'),
      expect.any(String),
      expect.objectContaining({ skipPreserveCheck: true }),
    )
  })
})

describe('saveConfigAndSnapshot() — write-truth contract (#2541)', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    mockWriteFile.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('throws when the arbiter.json write is withheld', () => {
    mockWriteFile.mockReturnValue(withheldResult(join(dir, 'arbiter.json')))
    expect(() => saveConfigAndSnapshot(dir, defaultConfig())).toThrow(/withheld/i)
  })

  it('throws when the config write lands but the snapshot write is withheld', () => {
    mockWriteFile.mockImplementation((path: string) =>
      path.includes('.arbiter-generated.json') ? withheldResult(path) : createdResult(path),
    )
    expect(() => saveConfigAndSnapshot(dir, defaultConfig())).toThrow(/withheld/i)
  })

  it('does not throw when both writes are benign identical-content skips', () => {
    mockWriteFile.mockImplementation((path: string) => benignSkipResult(path))
    expect(() => saveConfigAndSnapshot(dir, defaultConfig())).not.toThrow()
  })

  it('writes both files with skipPreserveCheck (exempt: neither is generator-emitted)', () => {
    mockWriteFile.mockImplementation((path: string) => createdResult(path))
    saveConfigAndSnapshot(dir, defaultConfig())
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('arbiter.json'),
      expect.any(String),
      expect.objectContaining({ skipPreserveCheck: true }),
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.arbiter-generated.json'),
      expect.any(String),
      expect.objectContaining({ skipPreserveCheck: true }),
    )
  })
})

describe('writeSnapshot() — write-truth contract (#2541)', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    mockWriteFile.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('throws when the snapshot write is withheld', () => {
    mockWriteFile.mockReturnValue(withheldResult(join(dir, '.arbiter-generated.json')))
    expect(() => writeSnapshot(dir, defaultConfig())).toThrow(/withheld/i)
  })

  it('does not throw when the write is a benign identical-content skip', () => {
    mockWriteFile.mockReturnValue(benignSkipResult(join(dir, '.arbiter-generated.json')))
    expect(() => writeSnapshot(dir, defaultConfig())).not.toThrow()
  })

  // Part B verdict: `.arbiter-generated.json` is documented (file-stability.md) as
  // "machine-written state file", "No" user-editable — generation provenance, the
  // same class as TDD evidence and the task-state document, never a generator
  // target a downstream repo would hand-customise and mark `arbiter:preserve`.
  it('writes the snapshot with skipPreserveCheck (exempt: machine-written provenance, not a generator target)', () => {
    mockWriteFile.mockReturnValue(createdResult(join(dir, '.arbiter-generated.json')))
    writeSnapshot(dir, defaultConfig())
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.arbiter-generated.json'),
      expect.any(String),
      expect.objectContaining({ skipPreserveCheck: true }),
    )
  })
})
