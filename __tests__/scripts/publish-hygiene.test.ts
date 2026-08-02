// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

interface PackedManifest {
  engines?: Record<string, string>
  scripts?: Record<string, string>
  bin?: unknown
  exports?: unknown
  main?: unknown
  files?: unknown
}

const packDir = mkdtempSync(join(tmpdir(), 'arbiter-publish-hygiene-'))
const workspaceDir = join(packDir, 'workspace')
let packedManifest: PackedManifest

beforeAll(() => {
  mkdirSync(workspaceDir)
  for (const path of [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'scripts',
    'src',
    'README.md',
    'LICENSE',
    'NOTICE',
    'CHANGELOG.md',
    'PRIVACY.md',
    'THIRD_PARTY_LICENSES.md',
  ]) {
    cpSync(resolve(path), join(workspaceDir, path), { recursive: true })
  }
  symlinkSync(resolve('node_modules'), join(workspaceDir, 'node_modules'), 'dir')
  const raw = execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: workspaceDir,
    encoding: 'utf-8',
  })
  const packed = JSON.parse(raw) as Array<{ filename: string }>
  const filename = packed[0]?.filename
  if (!filename) throw new Error('npm pack did not report a tarball filename')
  const manifestJson = execFileSync(
    'tar',
    ['-xOzf', join(packDir, basename(filename)), 'package/package.json'],
    { encoding: 'utf-8' },
  )
  packedManifest = JSON.parse(manifestJson) as PackedManifest
}, 60_000)

afterAll(() => {
  rmSync(packDir, { recursive: true, force: true })
})

describe('published package hygiene', () => {
  it('admits npm 11 while preserving the Node engine contract (AC-2128.1, AC-2128.2, AC-2128.3)', () => {
    const source = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as PackedManifest

    expect(packedManifest.engines?.node).toBe('>=22.0.0')
    expect(packedManifest.engines?.node).toBe(source.engines?.node)
    expect(packedManifest.engines?.npm).toBeDefined()
    expect(packedManifest.engines?.npm).not.toMatch(/<\s*11(?:\.0\.0)?/)
  })

  it('ships no development scripts and preserves consumer-critical fields (AC-2133.1, AC-2133.2, AC-2133.3)', () => {
    const source = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as PackedManifest

    expect(source.scripts?.prepare).toContain('core.hooksPath')
    expect(Object.keys(packedManifest.scripts ?? {})).toEqual([])
    for (const field of ['bin', 'exports', 'main', 'engines', 'files'] as const) {
      expect(packedManifest[field]).toEqual(source[field])
    }
  })
})
