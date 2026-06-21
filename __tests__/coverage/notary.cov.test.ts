// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/commands/notary.ts (#1486).
 *
 * Targets the under-covered branches in:
 *   - loadExemptions(): config-driven exemption array vs every early-return
 *     fallback to DEFAULT_EXEMPTIONS (null config, non-object, missing notary,
 *     null notary, non-object notary, missing exemptions key, non-array
 *     exemptions).
 *   - runNotaryCheck(): footer-present-but-invalid path (exit 1) and the
 *     backslash-normalized exemption guard.
 *   - runNotaryTemplate(): patchSet.size > 0 vs the "<INDEX> (N/A)" fallback.
 *
 * The dependency modules are stubbed with vi.doMock so no real git/gh/fs
 * subprocess runs; process.exit is spied so it never kills the runner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type CheckFn = (opts: { dir?: string | undefined }) => void
type TemplateFn = (opts: { dir?: string | undefined }) => void

interface StagedStub {
  docs: string[]
  msg: string
}

/** Stub the staged-git seam so no real `git` ever runs. */
function mockStaged(stub: StagedStub): void {
  vi.doMock('../../src/notary/staged.js', () => ({
    getStagedDocFiles: (): string[] => stub.docs,
    getStagedCommitMessage: (): string => stub.msg,
  }))
}

/** Stub loadConfig so no real arbiter.json is read. */
function mockConfig(value: unknown): void {
  vi.doMock('../../src/utils/config.js', () => ({
    loadConfig: (): unknown => value,
  }))
}

/** Stub getRequiredPatches so runNotaryTemplate's patch branch is controllable. */
function mockPatchDeps(patchesFor: (file: string) => string[]): void {
  vi.doMock('../../src/notary/patch-deps.js', () => ({
    getRequiredPatches: (file: string): string[] => patchesFor(file),
  }))
}

async function importCheck(): Promise<CheckFn> {
  const mod: { runNotaryCheck: CheckFn } = await import('../../src/commands/notary.js')
  return mod.runNotaryCheck
}

async function importTemplate(): Promise<TemplateFn> {
  const mod: { runNotaryTemplate: TemplateFn } = await import('../../src/commands/notary.js')
  return mod.runNotaryTemplate
}

describe('notary.ts loadExemptions branch matrix (via runNotaryCheck)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((): boolean => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((): boolean => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('../../src/notary/staged.js')
    vi.doUnmock('../../src/utils/config.js')
    vi.doUnmock('../../src/notary/patch-deps.js')
  })

  it('uses config.notary.exemptions[] when it is a valid array (custom exemption matches)', async () => {
    // Config provides a custom exemption "wip/" — the only staged doc lives
    // under it, so after filtering nothing remains and check passes (exit 0).
    mockConfig({ notary: { exemptions: ['wip/'] } })
    mockStaged({ docs: ['wip/draft.md'], msg: 'docs: wip draft, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
    const out = stdoutSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    expect(out).toContain('no doc changes require a Notary footer')
  })

  it('custom exemptions[] does NOT include the default folders (default no longer exempts)', async () => {
    // With a custom exemptions list, the built-in DEFAULT_EXEMPTIONS are
    // replaced — so a previously-default-exempt path now requires a footer.
    mockConfig({ notary: { exemptions: ['wip/'] } })
    mockStaged({ docs: ['.evidence/run.md'], msg: 'docs: evidence, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('falls back to DEFAULT_EXEMPTIONS when config is null', async () => {
    mockConfig(null)
    mockStaged({ docs: ['.claude/plans/p.md'], msg: 'chore: plan, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    // Default exemptions cover .claude/plans/ → nothing requires a footer.
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT_EXEMPTIONS when config is not an object', async () => {
    mockConfig('not-an-object')
    mockStaged({ docs: ['archives/old.md'], msg: 'chore: archive, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT_EXEMPTIONS when config lacks a notary key', async () => {
    mockConfig({ project: 'demo' })
    mockStaged({ docs: ['.evidence/x.md'], msg: 'chore: evidence, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT_EXEMPTIONS when config.notary is null', async () => {
    mockConfig({ notary: null })
    mockStaged({ docs: ['archives/y.md'], msg: 'chore: archive, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT_EXEMPTIONS when config.notary is not an object', async () => {
    mockConfig({ notary: 'enabled' })
    mockStaged({ docs: ['.claude/plans/q.md'], msg: 'chore: plan, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT_EXEMPTIONS when notary lacks an exemptions key', async () => {
    mockConfig({ notary: { enabled: true } })
    mockStaged({ docs: ['.evidence/z.md'], msg: 'chore: evidence, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT_EXEMPTIONS when notary.exemptions is not an array', async () => {
    mockConfig({ notary: { exemptions: 'archives/' } })
    mockStaged({ docs: ['archives/w.md'], msg: 'chore: archive, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('exits 1 when a non-exempt doc is staged without a footer (stderr guidance emitted)', async () => {
    mockConfig(null)
    mockStaged({ docs: ['docs/SYSTEM/CANON.md'], msg: 'docs: canon, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).toHaveBeenCalledWith(1)
    const err = stderrSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    expect(err).toContain('no Notary footer found')
  })

  it('exits 1 when footer is present but fails validation (missing Intent/Patch)', async () => {
    // A Notary block with only a Delta entry parses successfully but fails
    // validation (no Intent, no Patch) → the validation-error branch.
    mockConfig(null)
    mockStaged({
      docs: ['docs/SYSTEM/CANON.md'],
      msg: ['docs: canon', '', 'Notary:', '- Delta: docs/SYSTEM/CANON.md §A (modify, +1 -0)'].join(
        '\n',
      ),
    })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).toHaveBeenCalledWith(1)
    const err = stderrSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    expect(err).toContain('validation failed')
  })

  it('passes (exit 0) when footer is present and valid', async () => {
    mockConfig(null)
    mockStaged({
      docs: ['docs/SYSTEM/CANON.md'],
      msg: [
        'docs: canon',
        '',
        'Notary:',
        '- Delta: docs/SYSTEM/CANON.md §A (modify, +1 -0)',
        '- Intent: add rule per #256',
        '- Patch: docs/SSOT_CORE_SET.md (update)',
      ].join('\n'),
    })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
    const out = stdoutSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    expect(out).toContain('Notary footer valid')
  })

  it('normalizes backslash paths before applying exemptions', async () => {
    // A Windows-style staged path should normalize to ".evidence/..." and be
    // exempted by the default list → no footer required.
    mockConfig(null)
    mockStaged({ docs: ['.evidence\\win.md'], msg: 'chore: evidence, no footer' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('defaults opts.dir to "." when no dir is provided', async () => {
    mockConfig(null)
    mockStaged({ docs: [], msg: '' })
    const runNotaryCheck = await importCheck()
    runNotaryCheck({})
    expect(exitSpy).not.toHaveBeenCalled()
  })
})

describe('notary.ts runNotaryTemplate branch matrix', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((): boolean => true)
    vi.spyOn(process, 'exit').mockImplementation((): never => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('../../src/notary/staged.js')
    vi.doUnmock('../../src/utils/config.js')
    vi.doUnmock('../../src/notary/patch-deps.js')
  })

  it('prints concrete patch entries when getRequiredPatches yields patches (size > 0)', async () => {
    mockConfig(null)
    mockStaged({ docs: ['docs/SYSTEM/CANON.md'], msg: '' })
    mockPatchDeps((): string[] => ['docs/SSOT_CORE_SET.md', 'docs/KNOWLEDGE_MAP.md'])
    const runNotaryTemplate = await importTemplate()
    runNotaryTemplate({ dir: '/fake' })
    const out = stdoutSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    expect(out).toContain('docs/SSOT_CORE_SET.md (<update|N/A>)')
    expect(out).toContain('docs/KNOWLEDGE_MAP.md (<update|N/A>)')
    expect(out).not.toContain('<INDEX> (N/A)')
  })

  it('falls back to "<INDEX> (N/A)" when no patches are required (size === 0)', async () => {
    mockConfig(null)
    mockStaged({ docs: ['notes/scratch.md'], msg: '' })
    mockPatchDeps((): string[] => [])
    const runNotaryTemplate = await importTemplate()
    runNotaryTemplate({ dir: '/fake' })
    const out = stdoutSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    expect(out).toContain('<INDEX> (N/A)')
  })

  it('dedupes patches across multiple staged docs into a single Set', async () => {
    mockConfig(null)
    mockStaged({ docs: ['docs/a.md', 'docs/b.md'], msg: '' })
    mockPatchDeps((): string[] => ['docs/KNOWLEDGE_MAP.md'])
    const runNotaryTemplate = await importTemplate()
    runNotaryTemplate({ dir: '/fake' })
    const out = stdoutSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    // KNOWLEDGE_MAP appears exactly once despite two source docs.
    const occurrences = out.split('docs/KNOWLEDGE_MAP.md (<update|N/A>)').length - 1
    expect(occurrences).toBe(1)
    expect(out).toContain('Delta: docs/a.md')
    expect(out).toContain('Delta: docs/b.md')
  })

  it('prints "no doc changes staged" when all staged docs are exempted away', async () => {
    mockConfig(null)
    mockStaged({ docs: ['archives/old.md'], msg: '' })
    const runNotaryTemplate = await importTemplate()
    runNotaryTemplate({ dir: '/fake' })
    const out = stdoutSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    expect(out).toContain('no doc changes staged')
  })

  it('honors custom config exemptions in the template path', async () => {
    mockConfig({ notary: { exemptions: ['vendor/'] } })
    mockStaged({ docs: ['vendor/dep.md'], msg: '' })
    const runNotaryTemplate = await importTemplate()
    runNotaryTemplate({ dir: '/fake' })
    const out = stdoutSpy.mock.calls.map((c: unknown[]): string => String(c[0])).join('')
    expect(out).toContain('no doc changes staged')
  })
})
