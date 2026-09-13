// SPDX-License-Identifier: Apache-2.0
// #2504 — runDocSet's payload contract, isolated from the real engines: the engine is stubbed so
// the wrapper's handling of non-JSON and wrongly-shaped stdout is exercised directly.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../src/utils/run-cli.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/run-cli.js')>()),
  runCli: vi.fn(),
}))

import { runCli, CliError } from '../../src/utils/run-cli.js'
import { runDocSet, type DocSetOptions } from '../../src/commands/doc-set.js'

function engineSays(stdout: string): void {
  vi.mocked(runCli).mockReturnValue({ stdout, stderr: '', exitCode: 0, durationMs: 1 })
}

function envelopeOf(opts: DocSetOptions): { env: Record<string, unknown>; exitCode: number } {
  const writes: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  try {
    const { exitCode } = runDocSet({ repo: '.', json: true, ...opts })
    return { env: JSON.parse(writes.join('').trim()) as Record<string, unknown>, exitCode }
  } finally {
    spy.mockRestore()
  }
}

describe('#2504 — doc-set --json payload contract', () => {
  afterEach(() => vi.restoreAllMocks())

  it('non-JSON stdout without a [SKIP] marker is an error, not ok', () => {
    engineSays('something unexpected\n')
    const { env, exitCode } = envelopeOf({})
    expect(env.status).toBe('error')
    expect(exitCode).toBe(2)
  })

  it('an engine exit 1 with no JSON payload is exit 2, not the engine code', () => {
    vi.mocked(runCli).mockImplementation(() => {
      throw new CliError({
        cmd: 'node',
        args: [],
        exitCode: 1,
        stdout: 'check-doc-set: unexpected error\n',
        stderr: '',
        timedOut: false,
        notFound: false,
      })
    })
    const { env, exitCode } = envelopeOf({})
    expect(env.status).toBe('error')
    expect(exitCode).toBe(2)
  })

  it('a [SKIP] line is a non-ok envelope with the reason', () => {
    engineSays(
      'check-arc42-slots: SKIP — no architecture document present\n[SKIP] no architecture document present\n',
    )
    const { env } = envelopeOf({ arc42: true })
    expect(env.status).toBe('warning')
    expect(env.data).toEqual({ skipped: true, reason: 'no architecture document present' })
  })

  it.each<[string, DocSetOptions, string]>([
    ['presence given an arc42 payload', {}, '{"doc":"a.md","violations":[]}'],
    [
      'arc42 given a presence payload',
      { arc42: true },
      '{"manifest":"m","tierColumn":"solo","totals":{},"missingMandatory":[]}',
    ],
    ['freshness given an arc42 payload', { freshness: true }, '{"doc":"a.md","violations":[]}'],
    ['presence given malformed JSON', {}, '{"totals": '],
  ])('%s → error envelope, exit 2', (_name, opts, stdout) => {
    engineSays(stdout)
    const { env, exitCode } = envelopeOf(opts)
    expect(env.status).toBe('error')
    expect(exitCode).toBe(2)
  })
})
