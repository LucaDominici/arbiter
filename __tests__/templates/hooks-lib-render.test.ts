import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

/**
 * Tests for the rendered lib.mjs template.
 * Verifies that all expected exports are present after EJS rendering.
 */
describe('hooks/lib.mjs.ejs — rendered output', () => {
  const rendered = renderTemplate(
    'claude/hooks/lib.mjs.ejs',
    makeConfig('/tmp/test', { projectName: 'test-proj' }) as unknown as Record<string, unknown>,
  )

  it('contains logInfo, logWarn, logError exports', () => {
    expect(rendered).toContain('export const logInfo')
    expect(rendered).toContain('export const logWarn')
    expect(rendered).toContain('export const logError')
  })

  it('contains readTaskState export', () => {
    expect(rendered).toContain('export function readTaskState')
  })

  it('contains getRepoRoot export', () => {
    expect(rendered).toContain('export function getRepoRoot')
  })

  it('readTaskState reads the unified document and returns the 4 expected fields', () => {
    expect(rendered).toContain('.task')
    expect(rendered).toContain('status.json')
    expect(rendered).toContain('taskId')
    expect(rendered).toContain('phase')
    expect(rendered).toContain('plan')
    expect(rendered).toContain('tier')
  })

  it('readTaskState returns defaults for missing files', () => {
    expect(rendered).toContain('unknown')
  })

  it('getRepoRoot uses git rev-parse as primary method', () => {
    expect(rendered).toContain('rev-parse')
  })

  it('interpolates project name correctly', () => {
    expect(rendered).toContain('test-proj')
    expect(rendered).not.toContain('<%=')
  })

  it('contains the 5 consumer-local lib exports required by haben hooks (#2077 dual-track)', () => {
    expect(rendered).toContain('export function isPathInThisRepo')
    expect(rendered).toContain('export function reachesDispatch')
    expect(rendered).toContain('export function lintEnv')
    expect(rendered).toContain('export function addedLinesVsHEAD')
    expect(rendered).toContain('export function isDangerousCommand')
  })
})
