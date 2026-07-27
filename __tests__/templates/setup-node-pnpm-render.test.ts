// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// #1131 slice 2: the setup-node-pnpm composite is extended to bundle
// setup-node + `npm ci` (opt-out via the `install` input) and to pin a single
// canonical setup-node SHA. sync-action-pins (INV-76) does NOT scan composite
// action.yml, so this render test is the pin guard.

// Canonical setup-node pin the composite consolidates to (v7.0.0).
const CANONICAL_SETUP_NODE = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020'
const SELF_ACTION = readFileSync(resolve('.github/actions/setup-node-pnpm/action.yml'), 'utf-8')
const ABI_SCOPE_SCRIPT = resolve('.github/actions/setup-node-pnpm/native-abi-scope.sh')

function renderAction(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/actions/setup-node-pnpm/action.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

describe('setup-node-pnpm/action.yml.ejs — structural invariants (CANON-18, #1131)', () => {
  it('is a composite action', () => {
    expect(renderAction()).toContain('using: composite')
  })

  it('pins the single canonical setup-node SHA (v7.0.0) — INV-76 guard', () => {
    expect(renderAction()).toContain(CANONICAL_SETUP_NODE)
  })

  it('exposes an `install` input (opt-out for bare setup-node jobs)', () => {
    const rendered = renderAction()
    expect(rendered).toMatch(/^\s{2}install:/m)
  })

  it('runs `npm ci` gated on the install input, via bash', () => {
    const rendered = renderAction()
    expect(rendered).toContain('npm ci')
    expect(rendered).toContain("inputs.install == 'true'")
    expect(rendered).toContain('shell: bash')
  })

  it('still sets up node from .nvmrc with npm cache', () => {
    const rendered = renderAction()
    expect(rendered).toContain('node-version-file')
    expect(rendered).toContain('cache: npm')
  })
})

describe('self node_modules cache — native ABI isolation (#2147)', () => {
  it('uses the tested native ABI scope helper instead of runner OS alone', () => {
    expect(SELF_ACTION).toContain('id: native-abi')
    expect(SELF_ACTION).toContain('native-abi-scope.sh')
    expect(SELF_ACTION).toContain('steps.native-abi.outputs.scope')
    expect(SELF_ACTION).toContain(
      "hashFiles('package-lock.json', 'package.json', inputs.node-version-file)",
    )
    expect(SELF_ACTION).not.toContain(
      "key: node-modules-${{ runner.os }}-${{ hashFiles('package-lock.json', 'package.json', '.nvmrc') }}",
    )
  })

  it.each([
    {
      name: 'glibc',
      arch: 'X64',
      nodeVersion: 'v22.18.0',
      nodeModules: '127',
      getconf: { status: 0, output: 'glibc 2.31' },
      ldd: { status: 1, output: '' },
      expected: ['Linux-X64', 'glibc-2.31', 'node-v22.18.0', 'modules-127'],
    },
    {
      name: 'musl output with non-zero ldd status',
      arch: 'ARM64',
      nodeVersion: 'v22.19.0',
      nodeModules: '128',
      getconf: { status: 1, output: '' },
      ldd: { status: 1, output: 'musl libc (aarch64)\nVersion 1.2.4' },
      expected: [
        'Linux-ARM64',
        'musl-libc--aarch64--Version-1.2.4',
        'node-v22.19.0',
        'modules-128',
      ],
    },
  ])('computes a portable scope for $name', (fixture) => {
    const result = runAbiScope(fixture)
    expect(result.status, result.stderr).toBe(0)
    for (const part of fixture.expected) expect(result.stdout.trim()).toContain(part)
  })

  it('changes scope when the selected Node ABI changes', () => {
    const base = {
      name: 'node-a',
      arch: 'X64',
      nodeVersion: 'v20.0.0',
      nodeModules: '115',
      getconf: { status: 0, output: 'glibc 2.31' },
      ldd: { status: 1, output: '' },
      expected: [],
    }
    const first = runAbiScope(base)
    const second = runAbiScope({ ...base, nodeVersion: 'v22.0.0', nodeModules: '127' })
    expect(first.status).toBe(0)
    expect(second.status).toBe(0)
    expect(first.stdout.trim()).not.toBe(second.stdout.trim())
  })

  it('changes scope when the detected musl version changes', () => {
    const base = {
      name: 'musl-a',
      arch: 'ARM64',
      nodeVersion: 'v22.19.0',
      nodeModules: '128',
      getconf: { status: 1, output: '' },
      ldd: { status: 1, output: 'musl libc (aarch64)\nVersion 1.2.4' },
      expected: [],
    }
    const first = runAbiScope(base)
    const second = runAbiScope({
      ...base,
      ldd: { status: 1, output: 'musl libc (aarch64)\nVersion 1.2.5' },
    })
    expect(first.status).toBe(0)
    expect(second.status).toBe(0)
    expect(first.stdout.trim()).not.toBe(second.stdout.trim())
  })

  it('fails closed on unrelated output from a failing ldd', () => {
    const result = runAbiScope({
      name: 'ldd-error',
      arch: 'X64',
      nodeVersion: 'v22.18.0',
      nodeModules: '127',
      getconf: { status: 1, output: '' },
      ldd: { status: 1, output: 'ldd: cannot open shared object file' },
      expected: [],
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('cannot determine native ABI')
  })

  it('fails closed when no native ABI can be identified', () => {
    const result = runAbiScope({
      name: 'unknown',
      arch: 'X64',
      nodeVersion: 'v22.18.0',
      nodeModules: '127',
      getconf: { status: 1, output: '' },
      ldd: { status: 1, output: '' },
      expected: [],
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('cannot determine native ABI')
  })
})

interface AbiFixture {
  name: string
  arch: string
  nodeVersion: string
  nodeModules: string
  getconf: { status: number; output: string }
  ldd: { status: number; output: string }
  expected: string[]
}

function runAbiScope(fixture: AbiFixture) {
  const fakeBin = mkdtempSync(join(tmpdir(), 'arbiter-native-abi-'))
  try {
    writeFakeCommand(fakeBin, 'getconf', fixture.getconf)
    writeFakeCommand(fakeBin, 'ldd', fixture.ldd)
    writeFileSync(
      join(fakeBin, 'node'),
      `#!/usr/bin/env bash\nif [[ "$2" == "process.versions.modules" ]]; then printf '%s\\n' '${fixture.nodeModules}'; else printf '%s\\n' '${fixture.nodeVersion}'; fi\n`,
      { mode: 0o755 },
    )
    return spawnSync('bash', [ABI_SCOPE_SCRIPT], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        RUNNER_OS: 'Linux',
        RUNNER_ARCH: fixture.arch,
      },
    })
  } finally {
    rmSync(fakeBin, { recursive: true, force: true })
  }
}

function writeFakeCommand(
  fakeBin: string,
  name: string,
  outcome: { status: number; output: string },
) {
  writeFileSync(
    join(fakeBin, name),
    `#!/usr/bin/env bash\nprintf '%s\\n' '${outcome.output}'\nexit ${outcome.status}\n`,
    { mode: 0o755 },
  )
}
