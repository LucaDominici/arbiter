// SPDX-License-Identifier: Apache-2.0
// #2660: the build keeps only the .d.ts closure of the exports entry points, as tsc resolves it.
import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pruneDistDeclarations } from '../../scripts/prune-dist-declarations.mjs'

describe('prune-dist-declarations.mjs (#2660)', () => {
  it('deletes every dist .d.ts tsc does not reach from the exports entry points', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-prune-dts-'))
    try {
      mkdirSync(join(root, 'dist/deep'), { recursive: true })
      // tsc needs typescript + @types/node resolvable from the fake root
      symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir')
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'p',
          type: 'module',
          exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
        }),
      )
      writeFileSync(join(root, 'dist/index.js'), 'export const a = 1\n')
      writeFileSync(
        join(root, 'dist/index.d.ts'),
        "import type { Used } from './deep/used.js'\nexport declare const a: Used\n",
      )
      writeFileSync(join(root, 'dist/deep/used.d.ts'), 'export type Used = number\n')
      writeFileSync(join(root, 'dist/deep/unused.d.ts'), 'export type Unused = string\n')
      writeFileSync(join(root, 'dist/orphan.d.ts'), 'export declare const orphan: 1\n')
      const result = pruneDistDeclarations(root)
      expect(result).toEqual({ kept: 2, pruned: 2 })
      expect(existsSync(join(root, 'dist/index.d.ts'))).toBe(true)
      expect(existsSync(join(root, 'dist/deep/used.d.ts'))).toBe(true)
      expect(existsSync(join(root, 'dist/deep/unused.d.ts'))).toBe(false)
      expect(existsSync(join(root, 'dist/orphan.d.ts'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses (throws) when the probe resolves nothing — never prunes dist to zero', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-prune-dts-empty-'))
    try {
      mkdirSync(join(root, 'dist'))
      symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir')
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'p', type: 'module', exports: {} }),
      )
      writeFileSync(join(root, 'dist/lonely.d.ts'), 'export {}\n')
      expect(() => pruneDistDeclarations(root)).toThrow(/entry points/)
      expect(existsSync(join(root, 'dist/lonely.d.ts'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
