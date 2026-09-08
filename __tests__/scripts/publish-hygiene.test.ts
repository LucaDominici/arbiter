// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classifyPackSize } from '../../scripts/check-pack-size.mjs'

interface PackedManifest {
  engines?: Record<string, string>
  scripts?: Record<string, string>
  bin?: unknown
  exports?: unknown
  main?: unknown
  files?: unknown
}

interface PackSummary {
  filename: string
  unpackedSize: number
  entryCount: number
  files: Array<{ path: string }>
}

const packDir = mkdtempSync(join(tmpdir(), 'arbiter-publish-hygiene-'))
const workspaceDir = join(packDir, 'workspace')
let packedManifest: PackedManifest
let packSummary: PackSummary
let packedFiles: string[]
let extractedDir: string
let tarball: string

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
  const packed = JSON.parse(raw) as Array<PackSummary>
  const filename = packed[0]?.filename
  if (!filename) throw new Error('npm pack did not report a tarball filename')
  packSummary = packed[0]
  packedFiles = packSummary.files.map(({ path }) => path).sort()
  tarball = join(packDir, basename(filename))
  extractedDir = join(packDir, 'extracted')
  mkdirSync(extractedDir)
  execFileSync('tar', ['-xzf', tarball, '-C', extractedDir])
  const manifestJson = execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], {
    encoding: 'utf-8',
  })
  packedManifest = JSON.parse(manifestJson) as PackedManifest
}, 60_000)

afterAll(() => {
  rmSync(packDir, { recursive: true, force: true })
})

describe('published package hygiene', () => {
  const fixture = () =>
    JSON.parse(readFileSync(resolve('__tests__/fixtures/pack-contract-2597.json'), 'utf-8')) as {
      pack: { unpackedSize: number; entryCount: number; rosterSha256: string }
      manifest: PackedManifest
      required_engine_paths: string[]
      generated_profile_paths: string[]
      declarations: { count: number; pathsSha256: string }
      templates: { count: number; pathsSha256: string }
      leading_spdx: { count: number; pathsSha256: string }
    }
  const pathsDigest = (paths: string[]) =>
    createHash('sha256')
      .update([...paths].sort().join('\n'))
      .digest('hex')

  it('keeps the actual retained package under the unchanged strict budget (#2597 AC-1)', () => {
    const contract = fixture()

    expect(packSummary.unpackedSize).toBeLessThan(contract.pack.unpackedSize)
    expect(packSummary.entryCount).toBe(contract.pack.entryCount)
    expect(pathsDigest(packedFiles)).toBe(contract.pack.rosterSha256)
    expect(classifyPackSize(packSummary.unpackedSize, 'strict')).toEqual({
      level: 'ok',
      exitCode: 0,
    })
  })

  it('keeps the frozen package surface and generated assets in the actual tarball (#2597 AC-2)', () => {
    const contract = fixture()
    for (const field of ['bin', 'exports', 'engines', 'files'] as const) {
      expect(packedManifest[field]).toEqual(contract.manifest[field])
    }
    for (const path of [...contract.required_engine_paths, ...contract.generated_profile_paths]) {
      expect(packedFiles).toContain(path)
    }
    const declarations = packedFiles.filter((path) => path.endsWith('.d.ts'))
    const templates = packedFiles.filter((path) => path.startsWith('dist/templates/'))
    const spdx = packedFiles.filter((path) =>
      readFileSync(join(extractedDir, 'package', path), 'utf-8').startsWith(
        '// SPDX-License-Identifier:',
      ),
    )
    expect([declarations.length, pathsDigest(declarations)]).toEqual([
      contract.declarations.count,
      contract.declarations.pathsSha256,
    ])
    expect([templates.length, pathsDigest(templates)]).toEqual([
      contract.templates.count,
      contract.templates.pathsSha256,
    ])
    expect([spdx.length, pathsDigest(spdx)]).toEqual([
      contract.leading_spdx.count,
      contract.leading_spdx.pathsSha256,
    ])
    expect(readFileSync(join(extractedDir, 'package', 'dist', 'cli.js'), 'utf-8')).toMatch(/^#!/)
    expect(
      execFileSync('tar', ['-tvzf', tarball, 'package/dist/cli.js'], { encoding: 'utf-8' }),
    ).toMatch(/^-rwx/)
  })

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
