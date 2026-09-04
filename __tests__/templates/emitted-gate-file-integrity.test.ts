// #2197 — generated guard files distinguish never-emitted from deleted-at-runtime.
import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig, renderCheckAll } from '../helpers.js'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function render(template: string, overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    template,
    makeConfig('/tmp/arbiter-2197', {
      language: 'typescript',
      governanceLevel: 'L1',
      coverageEnabled: false,
      ...overrides,
    }) as unknown as Record<string, unknown>,
  )
}

async function renderedHelpers(dir: string): Promise<{
  gateFileState: (path: string, cwd?: string) => string
}> {
  const helpers = join(dir, 'run-helpers.mjs')
  writeFileSync(helpers, render('scripts/lib/run-helpers.mjs.ejs'))
  return (await import(`${pathToFileURL(helpers).href}?${Date.now()}`)) as {
    gateFileState: (path: string, cwd?: string) => string
  }
}

function writeSuccessfulCommandStubs(dir: string): string {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  for (const command of ['node', 'npx', 'npm', 'gitleaks']) {
    const path = join(bin, command)
    writeFileSync(path, '#!/bin/sh\nexit 0\n')
    chmodSync(path, 0o755)
  }
  return bin
}

function runRenderedGate(
  dir: string,
  overrides: Record<string, unknown> = {},
  args: string[] = ['L1'],
) {
  const scripts = join(dir, 'scripts')
  mkdirSync(join(scripts, 'lib'), { recursive: true })
  // #2041: check-all.mjs.ejs is registry-driven — render through the shared helper.
  writeFileSync(
    join(scripts, 'check-all.mjs'),
    renderCheckAll(
      makeConfig('/tmp/arbiter-2197', {
        language: 'typescript',
        governanceLevel: 'L1',
        coverageEnabled: false,
        ...overrides,
      }) as unknown as Record<string, unknown>,
    ),
  )
  writeFileSync(join(scripts, 'lib', 'run-helpers.mjs'), render('scripts/lib/run-helpers.mjs.ejs'))
  // #2427: the emitted gate imports the per-repo mutex helper.
  writeFileSync(join(scripts, 'lib', 'gate-mutex.mjs'), render('scripts/lib/gate-mutex.mjs.ejs'))
  const bin = writeSuccessfulCommandStubs(dir)
  return spawnSync(process.execPath, [join(scripts, 'check-all.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf-8',
    shell: false,
    timeout: 20_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, NO_COLOR: '1' },
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('rendered run-helpers — emitted gate-file state (#2197)', () => {
  it('classifies present, never-emitted, deleted, and unknown-no-manifest (AC-1)', async () => {
    const presentDir = tempDir('arbiter-2197-present-')
    writeFileSync(join(presentDir, 'guard.mjs'), '')
    const present = await renderedHelpers(presentDir)
    expect(present.gateFileState('guard.mjs', presentDir)).toBe('present')

    const neverDir = tempDir('arbiter-2197-never-')
    writeFileSync(
      join(neverDir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: {} }),
    )
    const never = await renderedHelpers(neverDir)
    expect(never.gateFileState('guard.mjs', neverDir)).toBe('never-emitted')

    const deletedDir = tempDir('arbiter-2197-deleted-')
    writeFileSync(
      join(deletedDir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: { 'guard.mjs': 'sha256' } }),
    )
    const deleted = await renderedHelpers(deletedDir)
    expect(deleted.gateFileState('guard.mjs', deletedDir)).toBe('deleted')

    const unknownDir = tempDir('arbiter-2197-unknown-')
    const unknown = await renderedHelpers(unknownDir)
    expect(unknown.gateFileState('guard.mjs', unknownDir)).toBe('unknown-no-manifest')

    const malformedDir = tempDir('arbiter-2197-malformed-')
    writeFileSync(join(malformedDir, '.arbiter-generated-manifest.json'), '{')
    const malformed = await renderedHelpers(malformedDir)
    expect(malformed.gateFileState('guard.mjs', malformedDir)).toBe('unknown-no-manifest')
  })
})

describe('rendered check-all — emitted guard deletion (#2197)', () => {
  it('fails and names a missing emitted static-analysis guard (AC-2)', () => {
    const dir = tempDir('arbiter-2197-gate-deleted-')
    writeFileSync(
      join(dir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: { 'eslint.config.static.mjs': 'sha256' } }),
    )

    const result = runRenderedGate(dir)
    const output = result.stdout + result.stderr

    expect(result.status).not.toBe(0)
    expect(output).toContain('eslint.config.static.mjs')
    expect(output).toContain('emitted by arbiter and is now missing')
    expect(existsSync(join(dir, '.arbiter', 'gate-pass.json'))).toBe(false)
  })

  it('keeps the existing SKIP for a static-analysis guard never emitted (AC-3)', () => {
    const dir = tempDir('arbiter-2197-gate-never-')
    writeFileSync(
      join(dir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: {} }),
    )

    const result = runRenderedGate(dir)
    const output = result.stdout + result.stderr

    expect(output).toContain('[CHECK] static analysis ... SKIP (run: arbiter update)')
    expect(output).not.toContain('emitted by arbiter and is now missing')
  })

  it('fails when the emitted frontend stylelint config was deleted (AC-4)', () => {
    const dir = tempDir('arbiter-2197-stylelint-deleted-')
    writeFileSync(
      join(dir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: { '.stylelintrc.json': 'sha256' } }),
    )

    const result = runRenderedGate(dir, { archetype: 'frontend-spa' })
    const output = result.stdout + result.stderr

    expect(result.status).not.toBe(0)
    expect(output).toContain('.stylelintrc.json')
    expect(output).toContain('emitted by arbiter and is now missing')
    expect(existsSync(join(dir, '.arbiter', 'gate-pass.json'))).toBe(false)
  })

  it.each(['.stylelintrc.json', '.stylelintrc'])(
    'runs lint:css when %s is present (AC-5)',
    (stylelintConfig) => {
      const dir = tempDir('arbiter-2197-stylelint-present-')
      writeFileSync(join(dir, stylelintConfig), '{}')

      const result = runRenderedGate(dir, { archetype: 'frontend-spa' })
      const output = result.stdout + result.stderr

      expect(result.status).toBe(0)
      expect(output).toContain('[CHECK] lint:css ... PASS')
    },
  )

  it('silently skips lint:css when no stylelint config was ever emitted (AC-6)', () => {
    const dir = tempDir('arbiter-2197-stylelint-never-')
    writeFileSync(
      join(dir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: {} }),
    )

    const result = runRenderedGate(dir, { archetype: 'frontend-spa' })
    const output = result.stdout + result.stderr

    expect(result.status).toBe(0)
    expect(output).not.toContain('lint:css')
  })

  it('degrades loudly but preserves the lint:css skip when the manifest is unavailable (AC-7)', () => {
    const dir = tempDir('arbiter-2197-stylelint-unknown-')

    const result = runRenderedGate(dir, { archetype: 'frontend-spa' })
    const output = result.stdout + result.stderr

    expect(result.status).toBe(0)
    expect(output).toContain(
      '[CHECK] lint:css ... DEGRADED — cannot determine whether .stylelintrc.json was emitted',
    )
  })

  it('fails when the emitted bundle budget was deleted while its gate script remains (AC-8)', () => {
    const dir = tempDir('arbiter-2197-bundle-budget-deleted-')
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-bundle-size.mjs'), '')
    writeFileSync(
      join(dir, '.arbiter-generated-manifest.json'),
      JSON.stringify({
        $schemaVersion: 1,
        files: {
          'scripts/check-bundle-size.mjs': 'sha256',
          'bundle-budget.json': 'sha256',
        },
      }),
    )

    const result = runRenderedGate(dir, { archetype: 'frontend-spa', governanceLevel: 'L2' }, [
      'L2',
    ])
    const output = result.stdout + result.stderr

    expect(result.status).not.toBe(0)
    expect(output).toContain('bundle-budget.json')
    expect(output).toContain('emitted by arbiter and is now missing')
    expect(existsSync(join(dir, '.arbiter', 'gate-pass.json'))).toBe(false)
  })

  it('does not fail an unselected gate for its deleted emitted guard (AC-9)', () => {
    const dir = tempDir('arbiter-2197-unselected-guard-deleted-')
    writeFileSync(
      join(dir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: { 'eslint.config.static.mjs': 'sha256' } }),
    )

    const result = runRenderedGate(dir, {}, ['L1', '--gate', 'typecheck'])
    const output = result.stdout + result.stderr

    expect(result.status).toBe(0)
    expect(output).not.toContain(
      'eslint.config.static.mjs was emitted by arbiter and is now missing',
    )
    expect(existsSync(join(dir, '.arbiter', 'gate-pass.json'))).toBe(false)
  })

  it('fails a selected gate for its deleted emitted guard (AC-10)', () => {
    const dir = tempDir('arbiter-2197-selected-guard-deleted-')
    writeFileSync(
      join(dir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: { 'eslint.config.static.mjs': 'sha256' } }),
    )

    const result = runRenderedGate(dir, {}, ['L1', '--gate', 'static analysis'])
    const output = result.stdout + result.stderr

    expect(result.status).not.toBe(0)
    expect(output).toContain('eslint.config.static.mjs was emitted by arbiter and is now missing')
    expect(existsSync(join(dir, '.arbiter', 'gate-pass.json'))).toBe(false)
  })

  it('reports but does not fail a deleted emitted guard during dry-run (AC-11)', () => {
    const dir = tempDir('arbiter-2197-dry-run-guard-deleted-')
    writeFileSync(
      join(dir, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: { 'eslint.config.static.mjs': 'sha256' } }),
    )

    const result = runRenderedGate(dir, {}, ['L1', '--dry-run'])
    const output = result.stdout + result.stderr

    expect(result.status).toBe(0)
    expect(output).toContain(
      '[CHECK] static analysis ... DRY-RUN (would FAIL — eslint.config.static.mjs was emitted by arbiter and is now missing)',
    )
    expect(existsSync(join(dir, '.arbiter', 'gate-pass.json'))).toBe(false)
  })
})
