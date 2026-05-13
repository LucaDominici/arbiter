import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('runNotaryCheck', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('exits 0 when no staged doc changes and no footer required', async () => {
    vi.doMock('../../src/notary/staged.js', () => ({
      getStagedDocFiles: (): string[] => [],
      getStagedCommitMessage: (): string => 'feat: no docs changed',
    }))
    const { runNotaryCheck } = await import('../../src/commands/notary.js')
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalledWith(1)
  })

  it('exits 1 when doc changes staged but no Notary footer', async () => {
    vi.doMock('../../src/notary/staged.js', () => ({
      getStagedDocFiles: (): string[] => ['docs/SYSTEM/CANON.md'],
      getStagedCommitMessage: (): string => 'docs: update canon — no footer',
    }))
    const { runNotaryCheck } = await import('../../src/commands/notary.js')
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits 0 when doc changes staged with valid Notary footer', async () => {
    vi.doMock('../../src/notary/staged.js', () => ({
      getStagedDocFiles: (): string[] => ['docs/SYSTEM/CANON.md'],
      getStagedCommitMessage: (): string =>
        `docs: update canon

Notary:
- Delta: docs/SYSTEM/CANON.md §Overview (modify, +1 -0)
- Intent: add CANON-16 rule per #256
- Patch: docs/SSOT_CORE_SET.md (update), docs/KNOWLEDGE_MAP.md (N/A)`,
    }))
    const { runNotaryCheck } = await import('../../src/commands/notary.js')
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalledWith(1)
  })

  it('exits 0 for exempted paths even without footer', async () => {
    vi.doMock('../../src/notary/staged.js', () => ({
      getStagedDocFiles: (): string[] => ['.evidence/run-001.md'],
      getStagedCommitMessage: (): string => 'chore: evidence update',
    }))
    const { runNotaryCheck } = await import('../../src/commands/notary.js')
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalledWith(1)
  })

  it('exits 0 for .claude/plans/ paths even without footer', async () => {
    vi.doMock('../../src/notary/staged.js', () => ({
      getStagedDocFiles: (): string[] => ['.claude/plans/plan-001.md'],
      getStagedCommitMessage: (): string => 'chore: plan update',
    }))
    const { runNotaryCheck } = await import('../../src/commands/notary.js')
    runNotaryCheck({ dir: '/fake' })
    expect(exitSpy).not.toHaveBeenCalledWith(1)
  })
})

describe('runNotaryTemplate', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('prints footer template when doc files are staged', async () => {
    vi.doMock('../../src/notary/staged.js', () => ({
      getStagedDocFiles: (): string[] => ['docs/SYSTEM/CANON.md'],
      getStagedCommitMessage: (): string => '',
    }))
    const { runNotaryTemplate } = await import('../../src/commands/notary.js')
    runNotaryTemplate({ dir: '/fake' })
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('Notary:')
    expect(output).toContain('Delta:')
    expect(output).toContain('Intent:')
    expect(output).toContain('Patch:')
  })

  it('prints "no doc changes staged" when nothing staged', async () => {
    vi.doMock('../../src/notary/staged.js', () => ({
      getStagedDocFiles: (): string[] => [],
      getStagedCommitMessage: (): string => '',
    }))
    const { runNotaryTemplate } = await import('../../src/commands/notary.js')
    runNotaryTemplate({ dir: '/fake' })
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('no doc changes staged')
  })
})
