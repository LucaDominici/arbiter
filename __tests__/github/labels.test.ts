import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as runCliModule from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  runCliJson: vi.fn(),
}))

const mockRunCli = vi.mocked(runCliModule.runCli)
const mockRunCliJson = vi.mocked(runCliModule.runCliJson)

describe('provisionLabels', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("surfaces list failure in result.errors with 'list labels failed:' prefix", async () => {
    const { provisionLabels } = await import('../../src/github/labels.js')
    mockRunCliJson.mockImplementation(() => {
      throw new Error('HTTP 401: Bad credentials')
    })
    // label edit/create succeed so they don't mask the list error
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = provisionLabels('owner', 'repo')

    expect(result.errors.some((e) => e.startsWith('list labels failed:'))).toBe(true)
    expect(result.errors[0]).toContain('HTTP 401: Bad credentials')
  })

  it('does not populate errors when label list succeeds', async () => {
    const { provisionLabels } = await import('../../src/github/labels.js')
    mockRunCliJson.mockReturnValue([])
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = provisionLabels('owner', 'repo')

    expect(result.errors).toHaveLength(0)
  })

  // ── Runtime validation tests (#296) ────────────────────────────────────────

  it('surfaces error when gh label list returns non-array (#296)', async () => {
    const { provisionLabels } = await import('../../src/github/labels.js')
    mockRunCliJson.mockReturnValue({ labels: [] }) // object, not array
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = provisionLabels('owner', 'repo')

    expect(result.errors.some((e) => e.includes('list labels failed:'))).toBe(true)
    expect(result.errors[0]).toContain('expected array')
  })

  it('surfaces error when gh label list item is missing "name" field (#296)', async () => {
    const { provisionLabels } = await import('../../src/github/labels.js')
    mockRunCliJson.mockReturnValue([{ id: 1 }]) // missing name
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = provisionLabels('owner', 'repo')

    expect(result.errors.some((e) => e.includes('list labels failed:'))).toBe(true)
    expect(result.errors[0]).toContain('name')
  })

  // ── Pagination tests ────────────────────────────────────────────────────────

  it('handles 250-label repos without truncation', async () => {
    const { provisionLabels } = await import('../../src/github/labels.js')
    const manyLabels = Array.from({ length: 250 }, (_, i) => ({
      name: `label-${String(i)}`,
    }))
    mockRunCliJson.mockReturnValue(manyLabels)
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = provisionLabels('owner', 'repo')

    // All standard labels should route to create (none of the 250 match)
    // and no errors (pagination worked)
    expect(result.errors).toHaveLength(0)
    expect(result.created.length + result.updated.length).toBeGreaterThan(0)
  })

  // ── Case-folding tests ──────────────────────────────────────────────────────

  it("routes label 'Bug' (capital) to edit when STANDARD has 'bug'", async () => {
    const { provisionLabels } = await import('../../src/github/labels.js')
    // Existing label on GitHub uses title-case
    mockRunCliJson.mockReturnValue([{ name: 'Bug' }])
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = provisionLabels('owner', 'repo')

    // STANDARD has "bug" lowercase → should find "Bug" via case-fold → edit, not create
    expect(result.updated).toContain('bug')
    expect(result.created).not.toContain('bug')
  })

  it("routes label 'SIZE:STANDARD' to edit when STANDARD has 'size:Standard'", async () => {
    const { provisionLabels } = await import('../../src/github/labels.js')
    // GitHub has all-caps variant; STANDARD has "size:Standard"
    mockRunCliJson.mockReturnValue([{ name: 'SIZE:STANDARD' }])
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    const result = provisionLabels('owner', 'repo')

    // Case-fold lookup: "size:standard" matches "SIZE:STANDARD" → edit, not create
    expect(result.updated).toContain('size:Standard')
    expect(result.created).not.toContain('size:Standard')
  })
})
