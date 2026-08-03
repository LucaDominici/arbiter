// #2197 — generated guard files distinguish never-emitted from deleted-at-runtime.
import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function render(template: string): string {
  return renderTemplate(
    template,
    makeConfig('/tmp/arbiter-2197', {
      language: 'typescript',
      governanceLevel: 'L1',
      coverageEnabled: false,
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
  for (const command of ['node', 'npx', 'npm']) {
    const path = join(bin, command)
    writeFileSync(path, '#!/bin/sh\nexit 0\n')
    chmodSync(path, 0o755)
  }
  return bin
}

function runRenderedGate(dir: string) {
  const scripts = join(dir, 'scripts')
  mkdirSync(join(scripts, 'lib'), { recursive: true })
  writeFileSync(join(scripts, 'check-all.mjs'), render('scripts/check-all.mjs.ejs'))
  writeFileSync(join(scripts, 'lib', 'run-helpers.mjs'), render('scripts/lib/run-helpers.mjs.ejs'))
  const bin = writeSuccessfulCommandStubs(dir)
  return spawnSync(process.execPath, [join(scripts, 'check-all.mjs'), 'L1'], {
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
})
