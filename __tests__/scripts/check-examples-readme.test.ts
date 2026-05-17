// SPDX-License-Identifier: Apache-2.0
// TDD red-phase test for #542: examples/README.md contains all 5 archetype walkthroughs
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const examplesReadme = resolve(repoRoot, 'examples/README.md')

describe('examples/README.md', () => {
  it('exists', () => {
    expect(existsSync(examplesReadme)).toBe(true)
  })

  it('links to all 5 archetype walkthroughs', () => {
    const content = readFileSync(examplesReadme, 'utf-8')
    const required = [
      'ts-frontend-spa.md',
      'java-backend-web-db.md',
      'rust-cli.md',
      'go-library.md',
      'python-data-pipeline.md',
    ]
    for (const link of required) {
      expect(content).toContain(link)
    }
  })
})
