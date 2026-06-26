// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { injectDevDependency, mutatePackageJson } from '../../src/utils/pkg.js'

describe('injectDevDependency (#1314 install-channel guard)', () => {
  let dir: string
  const pkgPath = (): string => join(dir, 'package.json')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-pkg-'))
    writeFileSync(pkgPath(), JSON.stringify({ name: 'demo', devDependencies: {} }, null, 2))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('injects a registry-pinned version', () => {
    injectDevDependency(dir, 'jscpd', '5.0.6', false)
    const pkg = JSON.parse(readFileSync(pkgPath(), 'utf-8')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies['jscpd']).toBe('5.0.6')
  })

  it('does not overwrite an existing dependency', () => {
    writeFileSync(pkgPath(), JSON.stringify({ devDependencies: { jscpd: '1.0.0' } }))
    injectDevDependency(dir, 'jscpd', '5.0.6', false)
    const pkg = JSON.parse(readFileSync(pkgPath(), 'utf-8')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies['jscpd']).toBe('1.0.0')
  })

  // Option C: volatile local install channels are structurally impossible.
  it.each([
    ['file:../arbiter/arbiter-cli-0.1.0.tgz'],
    ['file:../arbiter'],
    ['link:../arbiter'],
    ['portal:../arbiter'],
    ['./vendor/arbiter-cli-0.1.0.tgz'],
    ['https://example.com/pkg.tar.gz'],
  ])('throws on a volatile install channel: %s', (version) => {
    expect(() => injectDevDependency(dir, '@arbiter/cli', version, false)).toThrow(/volatile/i)
    // package.json must be left untouched (no partial write).
    const pkg = JSON.parse(readFileSync(pkgPath(), 'utf-8')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies['@arbiter/cli']).toBeUndefined()
  })

  it('rejects a volatile version even in dryRun (validated before the dryRun short-circuit)', () => {
    expect(() => injectDevDependency(dir, '@arbiter/cli', 'file:../x.tgz', true)).toThrow(
      /volatile/i,
    )
  })
})

describe('mutatePackageJson (#1519 single read-modify-write choke-point)', () => {
  let dir: string
  const pkgPath = (): string => join(dir, 'package.json')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-mutate-'))
    writeFileSync(pkgPath(), JSON.stringify({ name: 'demo', scripts: {} }, null, 2) + '\n')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes (pretty-printed + trailing newline) when the mutator reports a change', () => {
    mutatePackageJson(dir, false, (pkg) => {
      ;(pkg.scripts as Record<string, string>)['build'] = 'tsc'
      return true
    })
    const raw = readFileSync(pkgPath(), 'utf-8')
    expect(JSON.parse(raw)).toMatchObject({ scripts: { build: 'tsc' } })
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('\n  ') // 2-space indent
  })

  it('does NOT rewrite the file when the mutator reports no change (idempotent, byte-identical)', () => {
    const before = readFileSync(pkgPath(), 'utf-8')
    mutatePackageJson(dir, false, () => false)
    expect(readFileSync(pkgPath(), 'utf-8')).toBe(before)
  })

  it('is a no-op in dryRun (mutator never invoked, file untouched)', () => {
    const before = readFileSync(pkgPath(), 'utf-8')
    let invoked = false
    mutatePackageJson(dir, true, () => {
      invoked = true
      return true
    })
    expect(invoked).toBe(false)
    expect(readFileSync(pkgPath(), 'utf-8')).toBe(before)
  })

  it('is a no-op when package.json is absent (no throw)', () => {
    rmSync(pkgPath(), { force: true })
    expect(() =>
      mutatePackageJson(dir, false, () => {
        throw new Error('mutator must not run when package.json is absent')
      }),
    ).not.toThrow()
  })

  it('warns and leaves the file untouched on malformed package.json (no throw)', () => {
    writeFileSync(pkgPath(), '{ not valid json ')
    let invoked = false
    expect(() =>
      mutatePackageJson(dir, false, () => {
        invoked = true
        return true
      }),
    ).not.toThrow()
    expect(invoked).toBe(false)
    expect(readFileSync(pkgPath(), 'utf-8')).toBe('{ not valid json ')
  })
})

describe('#1519 façade-bypass closed: package.json generators route through utils/pkg.ts', () => {
  // The six injectX functions used to each call raw `node:fs` writeFileSync on the
  // user's package.json, bypassing the atomic temp-file+rename fs façade. A crash
  // or ENOSPC mid-write could truncate package.json. These generators must now own
  // NO raw write-op — every package.json write goes through mutatePackageJson.
  const generators = [
    'api-middleware.ts',
    'contract-testing.ts',
    'debt-gates.ts',
    'githooks.ts',
  ] as const

  it.each(generators)('%s imports no write-op from node:fs', (file) => {
    const src = readFileSync(join('src', 'generators', file), 'utf-8')
    const namedImport = src.match(/import\s*\{([^}]+)\}\s*from\s*'node:fs'/)
    const imported = namedImport ? namedImport[1] : ''
    expect(imported).not.toMatch(/\b(writeFileSync|appendFileSync|renameSync|copyFileSync)\b/)
  })

  it.each(generators)('%s contains no raw writeFileSync call', (file) => {
    const src = readFileSync(join('src', 'generators', file), 'utf-8')
    expect(src).not.toMatch(/\bwriteFileSync\s*\(/)
  })
})
