// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #1503: `npm run build` does `rm -rf dist && tsc`, and tsc does not preserve the
// executable bit on the emitted dist/cli.js. A globally npm-linked `arbiter` bin then
// fails with EACCES until chmod'd. npm-published installs are unaffected (npm sets the
// bin +x on install), but the local dev-link + dogfood flow breaks after every rebuild.
// The build script must restore the executable bit on the linked bin itself.
describe('build script keeps the linked bin executable (#1503)', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
    bin: Record<string, string>
    scripts: Record<string, string>
  }

  it('points the arbiter bin at dist/cli.js', () => {
    expect(pkg.bin.arbiter).toBe('./dist/cli.js')
  })

  it('build script chmods the bin executable after tsc emits it', () => {
    const build = pkg.scripts.build
    // The bin loses +x because tsc re-emits it; the build must restore it so the
    // npm-linked dev bin survives `rm -rf dist && tsc`.
    expect(build).toMatch(/chmod\s+\+x\s+dist\/cli\.js/)
  })
})
