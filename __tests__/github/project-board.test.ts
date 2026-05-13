import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as runCliModule from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  runCliJson: vi.fn(),
}))

const mockRunCli = vi.mocked(runCliModule.runCli)
const mockRunCliJson = vi.mocked(runCliModule.runCliJson)

describe('createProjectBoard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captures field-create failures in warnings[] while keeping created: true', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson.mockReturnValue({
      number: 42,
      url: 'https://github.com/orgs/o/projects/42',
    })
    mockRunCli.mockImplementation(() => {
      throw new Error('field-create: insufficient scope')
    })

    const result = createProjectBoard('owner', 'repo')

    expect(result.created).toBe(true)
    expect(result.error).toBeNull()
    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    expect(result.warnings.some((w) => w.includes('field-create: insufficient scope'))).toBe(true)
  })

  it('returns empty warnings when both field-creates succeed', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson.mockReturnValue({
      number: 1,
      url: 'https://github.com/orgs/o/projects/1',
    })
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo')

    expect(result.created).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('returns created: false and error when project create fails', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson.mockImplementation(() => {
      throw new Error('HTTP 403: Forbidden')
    })

    const result = createProjectBoard('owner', 'repo')

    expect(result.created).toBe(false)
    expect(result.error).toContain('HTTP 403: Forbidden')
  })

  // ── Idempotency tests ───────────────────────────────────────────────────────

  it('returns created: false and existing URL when board already exists', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // First call: project list returns existing board matching title
    mockRunCliJson.mockReturnValueOnce({
      projects: [
        {
          number: 7,
          title: 'repo Board',
          url: 'https://github.com/orgs/owner/projects/7',
        },
      ],
    })
    // Second call: field-list returns both fields already present
    mockRunCliJson.mockReturnValueOnce({
      fields: [{ name: 'Title' }, { name: 'Priority' }, { name: 'Size' }],
    })

    const result = createProjectBoard('owner', 'repo')

    expect(result.created).toBe(false)
    expect(result.projectUrl).toBe('https://github.com/orgs/owner/projects/7')
    expect(result.error).toBeNull()
    // project create must NOT have been called
    expect(mockRunCliJson.mock.calls.some((c) => c[1]?.includes('create'))).toBe(false)
  })

  it('calls project create exactly once when no matching board exists', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // First call: project list returns empty
    mockRunCliJson.mockReturnValueOnce({ projects: [] })
    // Second call: project create
    mockRunCliJson.mockReturnValueOnce({
      number: 3,
      url: 'https://github.com/orgs/owner/projects/3',
    })
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo')

    expect(result.created).toBe(true)
    expect(result.projectUrl).toBe('https://github.com/orgs/owner/projects/3')
    const createCalls = mockRunCliJson.mock.calls.filter((c) => c[1]?.includes('create'))
    expect(createCalls).toHaveLength(1)
  })

  it('creates missing Priority field when board exists without it', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // Board exists, Size present but not Priority
    mockRunCliJson.mockReturnValueOnce({
      projects: [
        {
          number: 5,
          title: 'repo Board',
          url: 'https://github.com/orgs/owner/projects/5',
        },
      ],
    })
    mockRunCliJson.mockReturnValueOnce({
      fields: [{ name: 'Title' }, { name: 'Size' }],
    })
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo')

    expect(result.created).toBe(false)
    const fieldCreateCalls = mockRunCli.mock.calls.filter((c) => c[1]?.includes('field-create'))
    expect(fieldCreateCalls).toHaveLength(1)
    expect(fieldCreateCalls[0][1]).toContain('Priority')
  })

  it('skips all field-create calls when board exists with both fields', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson.mockReturnValueOnce({
      projects: [
        {
          number: 9,
          title: 'repo Board',
          url: 'https://github.com/orgs/owner/projects/9',
        },
      ],
    })
    mockRunCliJson.mockReturnValueOnce({
      fields: [{ name: 'Title' }, { name: 'Priority' }, { name: 'Size' }],
    })

    createProjectBoard('owner', 'repo')

    expect(mockRunCli).not.toHaveBeenCalled()
  })
})
