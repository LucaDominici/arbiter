// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { Language } from '../../src/wizard/types.js'

// We test checkStackAdapter indirectly via the doctor health output.
// The function is not exported — we verify via integration with the module.
// We mock detectLanguage at the module level.

vi.mock('../../src/detectors/language.js', () => ({
  detectLanguage: vi.fn(() => 'typescript' as Language),
}))

import { detectLanguage } from '../../src/detectors/language.js'

// Import the internal function indirectly — we test via the exported function
// checkArbiterProject is not directly exported, so we test via the runHealth flow.
// We directly test the function by importing the module under test.
// Since checkStackAdapter is an internal function, we test its behavior by
// running the health check via the doctor module's exported behavior.

// Actually we need to test the HealthCheck result. Let's import the module
// and create a thin integration test that exercises checkStackAdapter.
// We achieve this by creating a temp dir with arbiter.json and varying
// adapter file presence.

function makeTmpDir(): string {
  const dir = join(tmpdir(), `doctor-adapter-test-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeArbiterProject(base: string): void {
  writeFileSync(join(base, 'arbiter.json'), JSON.stringify({ version: '1.0.0' }))
}

// #1343: the adapter-coverage check (INV-88, selfOnly) only runs against arbiter-self,
// detected by the globally-unique package name `@arbiter/cli`. Self-context tests must
// write that package.json so the check actually fires.
function makeArbiterSelf(base: string): void {
  writeFileSync(join(base, 'package.json'), JSON.stringify({ name: '@arbiter/cli' }))
}

function makeAdapterFile(base: string, lang: string): void {
  const adaptersDir = join(base, 'src', 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  writeFileSync(join(adaptersDir, `${lang}.ts`), '// stub\n')
}

// We test the checkStackAdapter logic directly by importing
// and calling the health module. Since the function is internal,
// we test its integration with the doctor command flow.

describe('doctor stack-adapter health check', () => {
  let tmp: string

  beforeEach(() => {
    tmp = makeTmpDir()
    makeArbiterProject(tmp)
  })

  afterEach(() => {
    vi.mocked(detectLanguage).mockReset()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('R5: PASS when adapter file exists for detected language (arbiter-self)', async () => {
    makeArbiterSelf(tmp)
    vi.mocked(detectLanguage).mockReturnValue('typescript')
    makeAdapterFile(tmp, 'typescript')

    // Dynamic import to pick up mocked detectLanguage
    const { checkStackAdapterHealth } = await import('../../src/commands/doctor.js')
    const result = checkStackAdapterHealth(tmp)
    expect(result.status).toBe('PASS')
    expect(result.detail).toContain('typescript')
  })

  it('R6: FAIL when adapter file is missing for detected language (arbiter-self)', async () => {
    makeArbiterSelf(tmp)
    vi.mocked(detectLanguage).mockReturnValue('typescript')
    // No adapter file created

    const { checkStackAdapterHealth } = await import('../../src/commands/doctor.js')
    const result = checkStackAdapterHealth(tmp)
    expect(result.status).toBe('FAIL')
    expect(result.detail).toContain('typescript')
  })

  // #1343 R4: on a CLIENT repo (not arbiter-self) the adapter-coverage check (INV-88,
  // selfOnly) must NOT fire — src/adapters/<lang>.ts is an arbiter-internal artifact, so a
  // Go-primary client (a prior internal project) no longer FAILs with a misleading "Create src/adapters/typescript.ts".
  it('R4: PASS advisory on a client repo even when adapter file is missing', async () => {
    // No @arbiter/cli package.json → not arbiter-self.
    vi.mocked(detectLanguage).mockReturnValue('typescript')

    const { checkStackAdapterHealth } = await import('../../src/commands/doctor.js')
    const result = checkStackAdapterHealth(tmp)
    expect(result.status).toBe('PASS')
    expect(result.hint).toBeUndefined()
    expect(result.detail).not.toContain('Create src/adapters')
  })

  it('PASS (exempt) for kotlin language (arbiter-self)', async () => {
    makeArbiterSelf(tmp)
    vi.mocked(detectLanguage).mockReturnValue('kotlin')

    const { checkStackAdapterHealth } = await import('../../src/commands/doctor.js')
    const result = checkStackAdapterHealth(tmp)
    expect(result.status).toBe('PASS')
    expect(result.detail).toContain('exempt')
  })

  it('PASS (exempt) for multi language (arbiter-self)', async () => {
    makeArbiterSelf(tmp)
    vi.mocked(detectLanguage).mockReturnValue('multi')

    const { checkStackAdapterHealth } = await import('../../src/commands/doctor.js')
    const result = checkStackAdapterHealth(tmp)
    expect(result.status).toBe('PASS')
    expect(result.detail).toContain('exempt')
  })

  it('WARN for unknown language (arbiter-self)', async () => {
    makeArbiterSelf(tmp)
    vi.mocked(detectLanguage).mockReturnValue('unknown')

    const { checkStackAdapterHealth } = await import('../../src/commands/doctor.js')
    const result = checkStackAdapterHealth(tmp)
    expect(result.status).toBe('WARN')
    expect(result.detail).toContain('detect')
  })

  it('PASS for go when go.ts adapter exists (arbiter-self)', async () => {
    makeArbiterSelf(tmp)
    vi.mocked(detectLanguage).mockReturnValue('go')
    makeAdapterFile(tmp, 'go')

    const { checkStackAdapterHealth } = await import('../../src/commands/doctor.js')
    const result = checkStackAdapterHealth(tmp)
    expect(result.status).toBe('PASS')
    expect(result.detail).toContain('go')
  })

  it('id is stack-adapter', async () => {
    makeArbiterSelf(tmp)
    vi.mocked(detectLanguage).mockReturnValue('kotlin')

    const { checkStackAdapterHealth } = await import('../../src/commands/doctor.js')
    const result = checkStackAdapterHealth(tmp)
    expect(result.id).toBe('stack-adapter')
  })
})
