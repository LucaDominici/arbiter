import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { detectPackageManager } from '../../src/detectors/package-manager.js'
import { resolveAxisFields } from '../../src/detectors/axis.js'
import { detectFramework } from '../../src/detectors/framework.js'
import { detectLanguage } from '../../src/detectors/language.js'

describe('brownfield: pnpm workspace package-manager detection', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('unknown')
    mkdirSync(join(dir, 'packages', 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'starlight-style-workspace',
        packageManager: 'pnpm@11.1.1',
        workspaces: ['packages/*'],
        devDependencies: { astro: '^5.0.0' },
      }),
    )
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    writeFileSync(
      join(dir, 'packages', 'docs', 'package.json'),
      JSON.stringify({ name: '@workspace/docs', private: true }),
    )
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('recognizes the full pnpm workspace fixture', () => {
    expect(detectPackageManager(dir)).toEqual({
      name: 'pnpm',
      source: 'packageManager-field',
      isWorkspace: true,
    })
  })

  it('classifies the root Astro app away from library', () => {
    const language = detectLanguage(dir)
    const framework = detectFramework(dir, language)

    expect(language).toBe('typescript')
    expect(framework).toBe('astro')
    expect(resolveAxisFields(null, dir, language, framework).archetype).not.toBe('library')
  })
})
