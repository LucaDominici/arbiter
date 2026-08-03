// SPDX-License-Identifier: Apache-2.0
// #2032: the `npx --no-install prettier` fallback made formatContent shell out to npm
// from inside the unit suite whenever the bundled binary was not visible (mocked fs,
// exotic install shape). npm then resolved a registry version and printed
// `npx canceled due to missing packages and no YES option: ["prettier@3.9.6"]` into the
// gate dump (observed in nightly run 30781101329). Registry-driven version resolution
// inside the test suite is nondeterminism by design: formatContent must resolve STRICTLY
// to the workspace binary, or do nothing.
//
// existsSync is mocked false so `resolveOwnPrettierBin` cannot find the bundled binary —
// exactly the shape that used to take the npx branch.
import { describe, it, expect, vi } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => false) }))
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {},
}))

import { runCli } from '../../src/utils/run-cli.js'
import { formatContent } from '../../src/utils/prettier-format.js'

const mockRunCli = runCli as unknown as MockInstance

describe('#2032 formatContent resolves strictly to the workspace prettier', () => {
  it('never spawns npx when the bundled binary is not resolvable', () => {
    const content = 'const x = {a:1}\n'
    const out = formatContent(content, '/tmp/nowhere/sample.ts', '/tmp/nowhere')

    expect(out).toBe(content)
    const commands = mockRunCli.mock.calls.map((c) => c[0])
    expect(commands).not.toContain('npx')
  })
})
