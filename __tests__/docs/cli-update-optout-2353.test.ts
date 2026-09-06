// SPDX-License-Identifier: Apache-2.0
// #2353 — the opt-out is only usable if it is documented. `website/reference/cli.md`
// is where `arbiter update`'s flags live; pin that `--only` and `.arbiterignore`
// (including the ignore-wins conflict rule) are described there, so a future flag
// table edit cannot quietly drop the one mechanism a consumer needs to find.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CLI_REF = resolve('website/reference/cli.md')
const read = (): string => readFileSync(CLI_REF, 'utf-8')

describe('#2353 — cli.md documents the update opt-out', () => {
  it('lists the --only flag in the `arbiter update` options', () => {
    expect(read()).toContain('`--only <globs>`')
  })

  it('documents the .arbiterignore file', () => {
    const doc = read()
    expect(doc).toContain('.arbiterignore')
    expect(doc).toMatch(/gitignore syntax/i)
  })

  it('states that .arbiterignore wins over --only', () => {
    expect(read()).toMatch(/`\.arbiterignore` wins/i)
  })

  it('states that an ignored file keeps its manifest entry', () => {
    expect(read()).toMatch(/\.arbiter-generated-manifest\.json/)
  })
})
