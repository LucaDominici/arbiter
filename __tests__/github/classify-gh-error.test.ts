// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { classifyGhError } from '../../src/github/classify-gh-error.js'
import { CliError } from '../../src/utils/run-cli.js'

function makeCliError(
  overrides: Partial<{
    exitCode: number
    stderr: string
    stdout: string
    timedOut: boolean
    notFound: boolean
  }>,
): CliError {
  return new CliError({
    cmd: 'gh',
    args: [],
    exitCode: overrides.exitCode ?? 1,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    timedOut: overrides.timedOut ?? false,
    notFound: overrides.notFound ?? false,
  })
}

describe('classifyGhError (#1074)', () => {
  it('gh binary not found → config', () => {
    expect(classifyGhError(makeCliError({ notFound: true }))).toBe('config')
  })

  it('401 unauthorized → fatal', () => {
    expect(classifyGhError(makeCliError({ exitCode: 1, stderr: 'HTTP 401: Unauthorized' }))).toBe(
      'fatal',
    )
  })

  it('"Bad credentials" → fatal', () => {
    expect(classifyGhError(makeCliError({ exitCode: 1, stderr: 'Bad credentials' }))).toBe('fatal')
  })

  it('"Token has been revoked" → fatal', () => {
    expect(classifyGhError(makeCliError({ exitCode: 1, stderr: 'Token has been revoked' }))).toBe(
      'fatal',
    )
  })

  it('"Could not resolve to a User" (missing GITHUB_TOKEN context) → fatal', () => {
    expect(
      classifyGhError(makeCliError({ exitCode: 1, stderr: 'authentication token not found' })),
    ).toBe('fatal')
  })

  it('network timeout → fatal', () => {
    expect(classifyGhError(makeCliError({ timedOut: true, exitCode: 1 }))).toBe('fatal')
  })

  it('404 not found → recoverable', () => {
    expect(classifyGhError(makeCliError({ exitCode: 1, stderr: 'HTTP 404: Not Found' }))).toBe(
      'recoverable',
    )
  })

  it('403 Must have admin rights → recoverable', () => {
    expect(
      classifyGhError(
        makeCliError({ exitCode: 1, stderr: 'Must have admin rights to Repository' }),
      ),
    ).toBe('recoverable')
  })

  it('403 Resource not accessible by personal access token → recoverable', () => {
    expect(
      classifyGhError(
        makeCliError({ exitCode: 1, stderr: 'Resource not accessible by personal access token' }),
      ),
    ).toBe('recoverable')
  })

  it('422 already exists → recoverable', () => {
    expect(classifyGhError(makeCliError({ exitCode: 1, stderr: 'already exists' }))).toBe(
      'recoverable',
    )
  })

  it('lowercase "bad credentials" → fatal (case-insensitive)', () => {
    expect(classifyGhError(makeCliError({ exitCode: 1, stderr: 'bad credentials' }))).toBe('fatal')
  })

  it('lowercase "http 401" → fatal (case-insensitive)', () => {
    expect(classifyGhError(makeCliError({ exitCode: 1, stderr: 'http 401: unauthorized' }))).toBe(
      'fatal',
    )
  })

  it('generic non-zero exit code defaults to recoverable', () => {
    expect(classifyGhError(makeCliError({ exitCode: 1, stderr: 'some unexpected error' }))).toBe(
      'recoverable',
    )
  })

  it('non-CliError defaults to recoverable', () => {
    expect(classifyGhError(new Error('unknown error'))).toBe('recoverable')
  })
})
