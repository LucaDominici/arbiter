// SPDX-License-Identifier: Apache-2.0
// #2662: `.arbiterignore` IS the retire mechanism (#2353) — no second list. This
// covers the CLI surface (`arbiter ignore add/remove`) and the `diff` reporting
// #2662 adds on top of it: a `retired` status/section/count distinct from the
// standing `ignored` status, and a `restore` status for AC(2) (a deleted file
// `update` would bring back).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { runDiff } from '../../src/commands/diff.js'
import { runIgnoreAdd, runIgnoreRemove } from '../../src/commands/ignore.js'

const TARGET = 'AGENTS.md'
const KEPT = 'DECISION_REGISTRY.md'

function manifestKeys(dir: string): string[] {
  const raw = JSON.parse(
    readFileSync(join(dir, '.arbiter-generated-manifest.json'), 'utf-8'),
  ) as Record<string, unknown>
  const files = (raw['files'] ?? raw) as Record<string, string>
  return Object.keys(files)
}

async function initProject(dir: string): Promise<void> {
  await runInit({
    yes: true,
    tools: 'claude',
    level: 'L1',
    dir,
    dryRun: false,
    brownfield: false,
    noVerify: true,
    language: 'typescript',
    archetype: 'library',
  })
}

function captureStdout(fn: () => void): string {
  const out: string[] = []
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      out.push(String(chunk))
      return true
    })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return out.join('')
}

describe('#2662 arbiter ignore add — CLI retire', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('writes the pattern, deletes the pristine file, and reports it retired', async () => {
    await initProject(dir)
    expect(existsSync(join(dir, TARGET))).toBe(true)

    const out = captureStdout(() => runIgnoreAdd({ dir, paths: [TARGET], json: false }))

    expect(existsSync(join(dir, TARGET))).toBe(false)
    expect(readFileSync(join(dir, '.arbiterignore'), 'utf-8')).toContain(`/${TARGET}`)
    expect(out).toContain('retired')
    expect(out).toContain(TARGET)
    // The manifest entry survives — retiring is reversible via `ignore remove`.
    expect(manifestKeys(dir)).toContain(TARGET)
  }, 60_000)

  it('a later `update` does not resurrect a CLI-retired file', async () => {
    await initProject(dir)
    runIgnoreAdd({ dir, paths: [TARGET], json: true })
    expect(existsSync(join(dir, TARGET))).toBe(false)

    await runUpdate({ dir, json: true, github: false })

    expect(existsSync(join(dir, TARGET))).toBe(false)
  }, 60_000)

  it('is idempotent: running add twice does not duplicate the pattern line', async () => {
    await initProject(dir)
    runIgnoreAdd({ dir, paths: [TARGET], json: true })
    runIgnoreAdd({ dir, paths: [TARGET], json: true })
    const lines = readFileSync(join(dir, '.arbiterignore'), 'utf-8')
      .split('\n')
      .filter((l) => l === `/${TARGET}`)
    expect(lines.length).toBe(1)
  }, 60_000)

  it('does not delete a user-modified file — reports it kept instead', async () => {
    await initProject(dir)
    writeFileSync(join(dir, TARGET), 'hand-edited content\n')

    const out = captureStdout(() => runIgnoreAdd({ dir, paths: [TARGET], json: false }))

    expect(existsSync(join(dir, TARGET))).toBe(true)
    expect(readFileSync(join(dir, TARGET), 'utf-8')).toBe('hand-edited content\n')
    expect(readFileSync(join(dir, '.arbiterignore'), 'utf-8')).toContain(`/${TARGET}`)
    expect(out).toContain('kept')
  }, 60_000)
})

describe('#2662 arbiter ignore remove', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('removes the pattern so the next update re-adopts the file', async () => {
    await initProject(dir)
    runIgnoreAdd({ dir, paths: [TARGET], json: true })
    expect(existsSync(join(dir, TARGET))).toBe(false)

    runIgnoreRemove({ dir, paths: [TARGET], json: true })
    expect(readFileSync(join(dir, '.arbiterignore'), 'utf-8')).not.toContain(TARGET)

    await runUpdate({ dir, json: true, github: false })
    expect(existsSync(join(dir, TARGET))).toBe(true)
  }, 60_000)

  it('reports still-ignored when a broader pattern still matches', async () => {
    await initProject(dir)
    writeFileSync(join(dir, '.arbiterignore'), `${TARGET}\n`)

    const out = captureStdout(() => runIgnoreRemove({ dir, paths: [TARGET], json: false }))

    expect(out).toContain('still ignored')
  }, 60_000)
})

describe('#2662 diff reports retired/restore as their own statuses', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  function diffJson(target: string): {
    hasChanges: boolean
    files: { path: string; status: string }[]
    retired: string[]
  } {
    const out = captureStdout(() => runDiff({ dir: target, json: true }))
    return (
      JSON.parse(out) as {
        data: { hasChanges: boolean; files: { path: string; status: string }[]; retired: string[] }
      }
    ).data
  }

  it('lists a CLI-retired file under `retired`, distinct from a merely-ignored one, and excludes it from hasChanges', async () => {
    await initProject(dir)
    runIgnoreAdd({ dir, paths: [TARGET], json: true })
    // KEPT stays ignored-but-present: still on disk, just declined.
    writeFileSync(
      join(dir, '.arbiterignore'),
      readFileSync(join(dir, '.arbiterignore'), 'utf-8') + `\n/${KEPT}\n`,
    )

    const result = diffJson(dir)
    expect(result.retired).toContain(TARGET)
    expect(result.retired).not.toContain(KEPT)
    expect(result.files.find((f) => f.path === TARGET)?.status).toBe('retired')
    expect(result.files.find((f) => f.path === KEPT)?.status).toBe('ignored')
    expect(result.hasChanges).toBe(false)
  }, 60_000)

  it('reports a deleted-but-not-ignored file as `restore`, and keeps it in hasChanges', async () => {
    await initProject(dir)
    rmSync(join(dir, TARGET))

    const result = diffJson(dir)
    expect(result.files.find((f) => f.path === TARGET)?.status).toBe('restore')
    expect(result.hasChanges).toBe(true)
  }, 60_000)
})
