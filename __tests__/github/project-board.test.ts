import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as runCliModule from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return {
    ...actual,
    runCli: vi.fn(),
    runCliJson: vi.fn(),
  }
})

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

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.created).toBe(true)
    expect(result.error).toBeNull()
    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    expect(result.warnings.some((w) => w.includes('field-create: insufficient scope'))).toBe(true)
  })

  it('returns empty warnings when both field-creates succeed', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson
      .mockReturnValueOnce({ projects: [] }) // findExistingBoard: no match
      .mockReturnValueOnce({ number: 1, url: 'https://github.com/orgs/o/projects/1' }) // create
      .mockReturnValueOnce({ fields: [] }) // existingFieldNames after create
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.created).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('returns created: false and error when project create fails', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson.mockImplementation(() => {
      throw new Error('HTTP 403: Forbidden')
    })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.created).toBe(false)
    expect(result.error).toContain('HTTP 403: Forbidden')
  })

  // ── Runtime validation tests (#296) ────────────────────────────────────────

  it('returns error when gh project list returns non-object (#296)', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson.mockReturnValue([]) // array instead of object with "projects"

    const result = createProjectBoard('owner', 'repo', 'myProject')

    // findExistingBoard catches the throw and returns null → falls through to create
    // then project create also gets mocked array → throws → error captured
    expect(result.error).toBeTruthy()
  })

  it('returns error when gh project list projects field is not an array (#296)', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // First call: project list returns object but projects is not an array
    mockRunCliJson.mockReturnValueOnce({ projects: 'not-an-array' })
    // Fallthrough to create — also malformed
    mockRunCliJson.mockReturnValueOnce({ not: 'a-project' })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.error).toBeTruthy()
    expect(result.created).toBe(false)
  })

  it('surfaces a malformed project element (missing title) in warnings (#1536)', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // project list: an element without a string "title" — the old code would
    // throw a cryptic "Cannot read properties of undefined (reading startsWith)"
    // deep inside .find(); validation must surface a clean diagnostic instead.
    mockRunCliJson.mockReturnValueOnce({ projects: [{ number: 1, url: 'u' }] })
    // fall through to create — also malformed so we stay on the error path
    mockRunCliJson.mockReturnValueOnce({ not: 'a-project' })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.warnings.some((w) => /title/i.test(w))).toBe(true)
  })

  it('surfaces a malformed field element (missing name) in warnings (#1536)', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // Board exists
    mockRunCliJson.mockReturnValueOnce({
      projects: [{ number: 3, title: 'myProject Board · owner/repo', url: 'https://x/3' }],
    })
    // field-list: an element without a string "name"
    mockRunCliJson.mockReturnValueOnce({ fields: [{ id: 'no-name' }] })
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.warnings.some((w) => /name/i.test(w))).toBe(true)
  })

  it('surfaces findExistingBoard errors in warnings[] when create succeeds (#474)', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson
      .mockImplementationOnce(() => {
        throw new Error('rate limit hit')
      })
      .mockReturnValueOnce({ number: 7, url: 'https://github.com/orgs/o/projects/7' })
      .mockReturnValueOnce({ fields: [] })
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.created).toBe(true)
    expect(result.warnings.some((w) => /rate limit hit/.test(w))).toBe(true)
  })

  it('returns error when gh project create output missing number/url fields (#296)', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // project list: empty
    mockRunCliJson.mockReturnValueOnce({ projects: [] })
    // project create: missing fields
    mockRunCliJson.mockReturnValueOnce({ title: 'repo Board' })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.created).toBe(false)
    expect(result.error).toContain('number')
  })

  // ── Idempotency tests ───────────────────────────────────────────────────────

  it('returns created: false and existing URL when board already exists', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // First call: project list returns existing board matching title
    mockRunCliJson.mockReturnValueOnce({
      projects: [
        {
          number: 7,
          title: 'myProject Board · owner/repo',
          url: 'https://github.com/orgs/owner/projects/7',
        },
      ],
    })
    // Second call: field-list returns both fields already present
    mockRunCliJson.mockReturnValueOnce({
      fields: [{ name: 'Title' }, { name: 'Priority' }, { name: 'Size' }],
    })

    const result = createProjectBoard('owner', 'repo', 'myProject')

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

    const result = createProjectBoard('owner', 'repo', 'myProject')

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
          title: 'myProject Board · owner/repo',
          url: 'https://github.com/orgs/owner/projects/5',
        },
      ],
    })
    mockRunCliJson.mockReturnValueOnce({
      fields: [{ name: 'Title' }, { name: 'Size' }],
    })
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.created).toBe(false)
    const fieldCreateCalls = mockRunCli.mock.calls.filter((c) => c[1]?.includes('field-create'))
    expect(fieldCreateCalls).toHaveLength(1)
    expect(fieldCreateCalls[0][1]).toContain('Priority')
  })

  // ── #492: existingFieldNames validation errors must surface ────────────────

  it('surfaces existingFieldNames malformed-output error in result.warnings when board exists (#492)', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // Board exists
    mockRunCliJson.mockReturnValueOnce({
      projects: [
        {
          number: 11,
          title: 'myProject Board · owner/repo',
          url: 'https://github.com/orgs/o/projects/11',
        },
      ],
    })
    // field-list returns malformed output (array instead of object)
    mockRunCliJson.mockReturnValueOnce([])
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.created).toBe(false)
    expect(result.warnings.some((w) => /existing-field-names|field-list/i.test(w))).toBe(true)
  })

  it('surfaces existingFieldNames error after create succeeds (#492)', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    // findExistingBoard: no match
    mockRunCliJson.mockReturnValueOnce({ projects: [] })
    // project create succeeds
    mockRunCliJson.mockReturnValueOnce({
      number: 22,
      url: 'https://github.com/orgs/o/projects/22',
    })
    // field-list malformed
    mockRunCliJson.mockReturnValueOnce({ fields: 'not-an-array' })
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = createProjectBoard('owner', 'repo', 'myProject')

    expect(result.created).toBe(true)
    expect(result.warnings.some((w) => /existing-field-names|field-list/i.test(w))).toBe(true)
  })

  it('skips all field-create calls when board exists with both fields', async () => {
    const { createProjectBoard } = await import('../../src/github/project-board.js')
    mockRunCliJson.mockReturnValueOnce({
      projects: [
        {
          number: 9,
          title: 'myProject Board · owner/repo',
          url: 'https://github.com/orgs/owner/projects/9',
        },
      ],
    })
    mockRunCliJson.mockReturnValueOnce({
      fields: [{ name: 'Title' }, { name: 'Priority' }, { name: 'Size' }],
    })

    createProjectBoard('owner', 'repo', 'myProject')

    expect(mockRunCli).not.toHaveBeenCalled()
  })
})
