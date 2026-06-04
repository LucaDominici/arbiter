// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const EXAMPLE_FILES = [
  'examples/python-data-pipeline.md',
  'examples/rust-cli.md',
  'examples/go-library.md',
]

describe('example docs — workflow filename accuracy', () => {
  for (const file of EXAMPLE_FILES) {
    it(`${file} does not reference the non-existent ci.yml workflow`, () => {
      const content = readFileSync(resolve(repoRoot, file), 'utf-8')
      expect(content).not.toContain('.github/workflows/ci.yml')
    })

    it(`${file} references the correct 01-pr-fast.yml workflow`, () => {
      const content = readFileSync(resolve(repoRoot, file), 'utf-8')
      expect(content).toContain('01-pr-fast.yml')
    })
  }
})
