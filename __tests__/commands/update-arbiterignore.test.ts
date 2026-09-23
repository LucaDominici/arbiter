// SPDX-License-Identifier: Apache-2.0
// #2353: per-file opt-out for `arbiter update` / `arbiter update --dry-run`.
//
// A consumer that wants ONE upstream fix must not have to accept the whole
// generated surface. Two halves of ONE mechanism:
//   - `.arbiterignore` (gitignore syntax, repo root) — permanent, honoured by
//     BOTH `update` and `diff`;
//   - `update --only <glob>` — the inverse allowlist, for a single run.
//
// The observable write here is RESTORATION (#2295): `update` re-emits any path it
// holds a manifest baseline for, so deleting a generated file and re-running is
// the cheapest deterministic "would write" signal.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { runDiff } from '../../src/commands/diff.js'
import { loadGeneratedManifest, saveGeneratedManifest } from '../../src/state/generated-manifest.js'

const IGNORED = 'AGENTS.md'
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

describe('#2353 .arbiterignore — update never rewrites an ignored managed file', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // `update` exits 1 whenever it restores a deleted file (#2295) — the very
    // signal these tests use as "would write". Neutralize the exit, keep the run.
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('does not re-emit a deleted file listed in .arbiterignore, and keeps its manifest entry', async () => {
    await initProject(dir)
    const before = manifestKeys(dir)
    expect(before).toContain(IGNORED)

    writeFileSync(join(dir, '.arbiterignore'), `# consumer keeps its own\n${IGNORED}\n`)
    rmSync(join(dir, IGNORED))
    rmSync(join(dir, KEPT))

    await runUpdate({ dir, json: true, github: false })

    expect(existsSync(join(dir, IGNORED))).toBe(false)
    // The control: an un-ignored deletion is still restored, so the assertion
    // above is about the ignore, not about update having stopped working.
    expect(existsSync(join(dir, KEPT))).toBe(true)
    // Re-adoptable: the entry survives so removing the pattern re-adopts the file.
    expect(manifestKeys(dir)).toContain(IGNORED)
  }, 60_000)

  it('counts the ignored file in the JSON summary', async () => {
    await initProject(dir)
    writeFileSync(join(dir, '.arbiterignore'), `${IGNORED}\n`)

    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        out.push(String(chunk))
        return true
      })
    try {
      await runUpdate({ dir, json: true, github: false })
    } finally {
      spy.mockRestore()
    }
    const payload = JSON.parse(out.join('')) as { data: { ignored: number } }
    expect(payload.data.ignored).toBe(1)
  }, 60_000)

  it('reports the skip as `skipped (.arbiterignore)` in the text preview', async () => {
    await initProject(dir)
    writeFileSync(join(dir, '.arbiterignore'), `${IGNORED}\n`)
    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        out.push(String(chunk))
        return true
      })
    try {
      await runUpdate({ dir, json: false, github: false })
    } finally {
      spy.mockRestore()
    }
    const text = out.join('')
    expect(text).toContain('skipped (.arbiterignore)')
    expect(text).toContain(IGNORED)
  }, 60_000)

  it('supports ! negation: the negated file is still managed', async () => {
    await initProject(dir)
    writeFileSync(join(dir, '.arbiterignore'), `*.md\n!${KEPT}\n`)
    rmSync(join(dir, IGNORED))
    rmSync(join(dir, KEPT))

    await runUpdate({ dir, json: true, github: false })

    expect(existsSync(join(dir, IGNORED))).toBe(false)
    expect(existsSync(join(dir, KEPT))).toBe(true)
  }, 60_000)
})

describe('#2353 diff honours .arbiterignore', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // `update` exits 1 whenever it restores a deleted file (#2295) — the very
    // signal these tests use as "would write". Neutralize the exit, keep the run.
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  function diffJson(target: string): {
    hasChanges: boolean
    files: { path: string; status: string }[]
  } {
    const out: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        out.push(String(chunk))
        return true
      })
    try {
      runDiff({ dir: target, json: true })
    } finally {
      stdoutSpy.mockRestore()
    }
    return (
      JSON.parse(out.join('')) as {
        data: { hasChanges: boolean; files: { path: string; status: string }[] }
      }
    ).data
  }

  it('reports an ignored file as ignored, and stops counting it as a pending change', async () => {
    await initProject(dir)
    rmSync(join(dir, IGNORED))

    // Self-calibrating: whatever this build's fresh init leaves pending IS the set
    // that must flip to `ignored`, so the assertion cannot rot as templates change.
    const before = diffJson(dir)
    const pending = before.files.filter((f) => f.status !== 'unchanged').map((f) => f.path)
    expect(pending).toContain(IGNORED)
    expect(before.hasChanges).toBe(true)

    writeFileSync(join(dir, '.arbiterignore'), pending.map((p) => `/${p}`).join('\n'))

    const after = diffJson(dir)
    // #2662: IGNORED was deleted before being ignored — that combination is a
    // declared RETIREMENT (own status), distinct from a merely-ignored file
    // that is still present on disk.
    expect(after.files.find((f) => f.path === IGNORED)?.status).toBe('retired')
    for (const path of pending.filter((p) => p !== IGNORED)) {
      expect(after.files.find((f) => f.path === path)?.status).toBe('ignored')
    }
    // Neither an ignored nor a retired file is a pending write: must not pin
    // diff's exit code at 1.
    expect(after.hasChanges).toBe(false)
  }, 60_000)
})

describe('#2353 update --only', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // `update` exits 1 whenever it restores a deleted file (#2295) — the very
    // signal these tests use as "would write". Neutralize the exit, keep the run.
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('writes only the matching path and PRESERVES the whole manifest', async () => {
    await initProject(dir)
    // Settle first: a plain update prunes the keys this config no longer emits, so
    // the comparison isolates `--only`'s effect from that pre-existing pruning.
    await runUpdate({ dir, json: true, github: false })
    const before = manifestKeys(dir)
    rmSync(join(dir, IGNORED))
    rmSync(join(dir, KEPT))

    await runUpdate({ dir, json: true, github: false, only: [KEPT] })

    expect(existsSync(join(dir, KEPT))).toBe(true)
    expect(existsSync(join(dir, IGNORED))).toBe(false)
    // The whole point: a scoped run must not amputate the manifest to the one path
    // it touched. Superset, not equality — a restored file legitimately (re-)enters
    // the manifest, and a key must never LEAVE it because of `--only`.
    const after = manifestKeys(dir)
    expect(after).toEqual(expect.arrayContaining(before))
    expect(after.length).toBeGreaterThanOrEqual(before.length)
  }, 60_000)

  // #2855: a doc-set skeleton the consumer filled in is never rendered again, so no
  // generator visits it; `--only` must still leave its provenance entry alone.
  it('keeps the manifest entry of an unvisited out-of-scope doc-set file', async () => {
    const DOC = 'docs/GLOSSARY.md'
    await initProject(dir)
    expect(manifestKeys(dir)).toContain(DOC)
    writeFileSync(join(dir, DOC), '# Glossary\n\nReal consumer content.\n')

    await runUpdate({ dir, json: true, github: false, only: [IGNORED] })

    expect(readFileSync(join(dir, DOC), 'utf-8')).toContain('Real consumer content.')
    expect(manifestKeys(dir)).toContain(DOC)

    // Control: once the file is IN scope, the ordinary full-run rule applies again —
    // `--only` scopes the run, it does not resurrect every prior entry.
    await runUpdate({ dir, json: true, github: false, only: [DOC] })
    expect(manifestKeys(dir)).not.toContain(DOC)
  }, 60_000)

  // #2855 review P1: out of `--only` scope is decided by the allowlist alone — an
  // `.arbiterignore` verdict on the same key must not re-open it to pruning or retirement.
  it('keeps ignored outside-only provenance and never retires it, in plan or apply', async () => {
    const DOC = 'docs/GLOSSARY.md'
    const HOOK = '.claude/hooks/pre-task-track-detect.mjs'
    const BODY = '#!/usr/bin/env node\n// Arbiter hook: retired track detector\nprocess.exit(0)\n'
    await initProject(dir)
    writeFileSync(join(dir, DOC), '# Glossary\n\nReal consumer content.\n')
    writeFileSync(join(dir, HOOK), BODY)
    const manifest = loadGeneratedManifest(dir)
    manifest[HOOK] = createHash('sha256').update(BODY).digest('hex')
    saveGeneratedManifest(dir, manifest)
    writeFileSync(join(dir, '.arbiterignore'), `${DOC}\n${HOOK}\n`)

    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        out.push(String(chunk))
        return true
      })
    try {
      await runUpdate({ dir, json: true, github: false, only: [IGNORED], adoptPlan: true })
    } finally {
      spy.mockRestore()
    }
    const plan = (JSON.parse(out.join('')) as { data: { wouldRetire: string[]; stale: string[] } })
      .data
    expect([...plan.wouldRetire, ...plan.stale]).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/GLOSSARY|pre-task-track-detect/)]),
    )

    await runUpdate({ dir, json: true, github: false, only: [IGNORED] })
    expect(existsSync(join(dir, HOOK))).toBe(true)
    expect(manifestKeys(dir)).toEqual(expect.arrayContaining([DOC, HOOK]))
  }, 60_000)

  it('lets .arbiterignore WIN over a conflicting --only, and says why', async () => {
    await initProject(dir)
    writeFileSync(join(dir, '.arbiterignore'), `${KEPT}\n`)
    rmSync(join(dir, KEPT))

    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        out.push(String(chunk))
        return true
      })
    try {
      await runUpdate({ dir, json: false, github: false, only: [KEPT] })
    } finally {
      spy.mockRestore()
    }

    expect(existsSync(join(dir, KEPT))).toBe(false)
    const text = out.join('')
    expect(text).toContain('.arbiterignore')
    expect(text).toContain('--only')
  }, 60_000)

  it('warns when --only matches nothing rather than silently doing nothing', async () => {
    await initProject(dir)
    const err: string[] = []
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        err.push(String(chunk))
        return true
      })
    try {
      await runUpdate({ dir, json: false, github: false, only: ['no/such/path.md'] })
    } finally {
      spy.mockRestore()
    }
    expect(err.join('')).toContain('--only')
  }, 60_000)
})
