// SPDX-License-Identifier: Apache-2.0
// #2416 — `arbiter plugin add` was documented on the public website and in
// CONTRIBUTING.md/examples/plugins/spring-boot/README.md as a scaffolder
// ("creates index.js/package.json/templates/") while no such command existed
// (src/cli.ts listed `plugin` as an unregistered nested name). Decision: ship
// a minimal `plugin add`/`plugin list` (resolve + install + register in
// arbiter.json, no scaffolder) and rewrite the four docs to match. This test
// pins the doc side of that decision so it cannot silently drift back to
// promising a scaffolder the command doesn't provide.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

const PLUGIN_RECIPE = 'website/recipes/plugin.md'
const CUSTOM_INVARIANT_RECIPE = 'website/recipes/custom-invariant.md'
const SPRING_BOOT_README = 'examples/plugins/spring-boot/README.md'
const CONTRIBUTING = 'CONTRIBUTING.md'

describe('#2416 — plugin add docs match the shipped minimal command', () => {
  it('plugin.md no longer promises a scaffolder that creates index.js/package.json/templates/', () => {
    const text = read(PLUGIN_RECIPE)
    expect(text).not.toContain('This creates:')
    expect(text).not.toMatch(/^## Scaffold\s*$/m)
    expect(text).toMatch(/does not scaffold/)
  })

  it('plugin.md still instructs the real `arbiter plugin add` command', () => {
    expect(read(PLUGIN_RECIPE)).toMatch(/`arbiter plugin add /)
  })

  it('custom-invariant.md no longer promises a scaffolded index.js stub', () => {
    const text = read(CUSTOM_INVARIANT_RECIPE)
    expect(text).not.toContain('This creates `my-rules/index.js` with a minimal')
  })

  it('custom-invariant.md still instructs the real `arbiter plugin add` command', () => {
    expect(read(CUSTOM_INVARIANT_RECIPE)).toMatch(/`arbiter plugin add /)
  })

  it('spring-boot README instructs the real `arbiter plugin add` command', () => {
    expect(read(SPRING_BOOT_README)).toMatch(/arbiter plugin add arbiter-plugin-spring-boot/)
  })

  it('spring-boot README no longer cites the phantom `arbiter integrations` command', () => {
    expect(read(SPRING_BOOT_README)).not.toMatch(/`arbiter integrations/)
  })

  it('CONTRIBUTING.md no longer tells contributors to "Scaffold a plugin with `arbiter plugin add`"', () => {
    expect(read(CONTRIBUTING)).not.toMatch(/Scaffold a plugin with `arbiter plugin add/)
  })

  it('CONTRIBUTING.md still points at the real `arbiter plugin add` command', () => {
    expect(read(CONTRIBUTING)).toMatch(/`arbiter plugin add /)
  })
})
