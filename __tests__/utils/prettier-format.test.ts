// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatContent } from '../../src/utils/prettier-format.js'

describe('prettier-format production resolution (#1651)', () => {
  it('lists prettier as a production dependency, not a devDependency', () => {
    // `formatContent` resolves prettier at RUNTIME via `require.resolve` from
    // arbiter's own tree. A published `npm i -g`/`npx` install only materialises
    // `dependencies`, so prettier MUST live there — otherwise every real install
    // silently no-ops formatting and warns per file. This guard fails the gate if
    // prettier is ever demoted back to devDependencies (regression of #1651).
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.prettier).toBeTypeOf('string')
    expect(pkg.devDependencies?.prettier).toBeUndefined()
  })

  describe('formatContent', () => {
    let target: string
    beforeEach(() => {
      // A fresh scaffold has NO node_modules — this is exactly the production
      // shape where the `npx --no-install` fallback cannot work. Only the bundled
      // (own-tree) prettier can format here, so a green result pins that path.
      target = mkdtempSync(join(tmpdir(), 'arbiter-prettier-'))
    })
    afterEach(() => {
      rmSync(target, { recursive: true, force: true })
    })

    it('formats unformatted content via arbiter own bundled prettier', () => {
      const unformatted = 'const x = {a:1,b:2}\n'
      const out = formatContent(unformatted, join(target, 'sample.ts'), target)
      // prettier normalises spacing/quotes/semicolons deterministically.
      expect(out).toBe('const x = { a: 1, b: 2 };\n')
      expect(out).not.toBe(unformatted)
    })

    it('returns the original content unchanged for an unformattable file type', () => {
      const content = 'not::valid::prettier::input'
      const out = formatContent(content, join(target, 'weird.unknownext'), target)
      expect(out).toBe(content)
    })
  })
})
