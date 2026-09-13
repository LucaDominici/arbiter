// SPDX-License-Identifier: Apache-2.0
// #2673: release workflow red — attest-build-provenance re-pin + stryker entry repair.
// The 0.6.0 tag (#2672) failed before publishing: attest-build-provenance@520aba2 (labeled v2)
// no longer resolves upstream, and Stryker's vitest.configFile pointed at a nonexistent
// vite.config.ts. This pins the fix so a future re-pin regresses loudly instead of red on tag.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const PIN = 'actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be'

const ATTEST_FILES = [
  '.github/actions/sign-and-attest/action.yml',
  '.github/workflows/05-release.yml',
  'src/templates/github/actions/sign-and-attest/action.yml.ejs',
  'src/templates/github/workflows/05-release.yml.ejs',
]

describe('release 05-release attest pin (#2673)', () => {
  it.each(ATTEST_FILES)('%s pins attest-build-provenance to the resolvable v2.4.0 SHA', (file) => {
    const content = readFileSync(resolve(root, file), 'utf-8')
    expect(content).toContain(PIN)
  })

  it('stryker.config.json points vitest at the in-place stryker config, not vite.config.ts', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'stryker.config.json'), 'utf-8'))
    expect(config.vitest.configFile).toBe('vitest.stryker.config.ts')
  })
})
