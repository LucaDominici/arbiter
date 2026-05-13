import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'
import { generateSecurity } from '../../src/generators/security.js'

vi.mock('../../src/utils/render.js')

describe('generateSecurity — missing template produces clear error (#300)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('throws a clear actionable error when a template file is missing', () => {
    vi.mocked(renderTemplate).mockImplementationOnce(() => {
      const err = new Error("ENOENT: no such file or directory, open 'scripts/pii-scan.mjs.ejs'")
      ;(err as NodeJS.ErrnoException).code = 'ENOENT'
      throw err
    })
    const config = makeConfig(dir, { enableSecurityScanning: true })
    expect(() => generateSecurity(config)).toThrow(/security\.ts: template not found/)
  })
})
