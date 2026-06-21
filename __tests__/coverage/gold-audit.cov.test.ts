// SPDX-License-Identifier: Apache-2.0
// Branch-coverage climb for src/commands/gold-audit.ts (#1486). The engine (scripts/gold-audit.mjs)
// is shelled through runCli; we mock that one seam (the established pattern, see
// __tests__/affinity/gh-issues.test.ts) so every delegation branch — --check, --cockpit, --json,
// SKIP, quiet, engine-failure, invalid-JSON, render-failure — is exercised deterministically with
// no real subprocess. CliError stays real so `err instanceof CliError` resolves correctly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as runCliModule from '../../src/utils/run-cli.js'
import { CliError, type RunCliResult } from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return { ...actual, runCli: vi.fn() }
})

import {
  runGoldAudit,
  type GoldAuditPayload,
  type FreshnessInfo,
} from '../../src/commands/gold-audit.js'

const mockRunCli = vi.mocked(runCliModule.runCli)

/** Build a runCli success result with the given stdout (stderr/exit/duration are inert defaults). */
function ok(stdout: string, stderr = ''): RunCliResult {
  return { stdout, stderr, exitCode: 0, durationMs: 1 }
}

/** Build a CliError as the real engine would throw on a non-zero exit / not-found. */
function cliErr(opts: {
  exitCode: number
  stdout?: string
  stderr?: string
  notFound?: boolean
}): CliError {
  return new CliError({
    cmd: 'node',
    args: ['scripts/gold-audit.mjs'],
    exitCode: opts.exitCode,
    stdout: opts.stdout ?? '',
    stderr: opts.stderr ?? '',
    timedOut: false,
    notFound: opts.notFound ?? false,
  })
}

const PAYLOAD: GoldAuditPayload = {
  registryVersion: '1.0.0',
  score: 62,
  yCount: 5,
  riskyCount: 1,
  totals: { checks: 6, y: 5, p: 1, n: 1, na: 1, nv: 1 },
  dimensions: { 'D-A': { score: 50, y: 2 }, 'D-B': { score: 75, y: 3 } },
  checks: [
    {
      id: 'A-1',
      dimension: 'D-A',
      title: 'a one',
      type: 'file_exists',
      verdict: 'Y',
      weight: 1,
      risk: 'SAFE',
      anchor: null,
      evidence: null,
    },
    {
      id: 'A-2',
      dimension: 'D-A',
      title: 'a two',
      type: 'file_exists',
      verdict: 'N',
      weight: 1,
      risk: 'RISKY',
      anchor: null,
      evidence: { file: 'README.md', detail: 'missing install' },
    },
  ],
  level: {
    level: 'L1',
    nextLevel: 'L2',
    toNextLevel: 13,
    brownfieldClass: 'gold',
    thresholds: [50, 75, 95],
  },
  gaps: [
    {
      dimension: 'D-A',
      checks: [
        {
          id: 'A-2',
          title: 'a two',
          verdict: 'N',
          anchor: null,
          evidence: { file: 'README.md', detail: 'missing install' },
        },
      ],
    },
  ],
}

const FRESH: FreshnessInfo = {
  status: 'PARTIAL',
  counts: { total: 3, present: 2, fresh: 1 },
  staleHours: 24,
}

/** Capture process stdout/stderr writes (typed, no `any`). Restored in afterEach. */
let outChunks: string[]
let errChunks: string[]
let outSpy: ReturnType<typeof vi.spyOn>
let errSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  outChunks = []
  errChunks = []
  outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    outChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  })
  errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    errChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  })
  mockRunCli.mockReset()
})
afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
})

const stdout = (): string => outChunks.join('')
const stderr = (): string => errChunks.join('')

// ── default --json / human path (runGoldAudit core) ─────────────────────────────
describe('runGoldAudit default path (#1414)', () => {
  it('json mode pretty-prints the payload and returns exit 0', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify(PAYLOAD)))
    const res = runGoldAudit({ repo: '/tmp/x', json: true, class: 'gold' })
    expect(res.exitCode).toBe(0)
    expect(res.payload).toBeTruthy()
    // pretty JSON (2-space indent) was written
    expect(stdout()).toContain('"registryVersion": "1.0.0"')
  })

  it('human mode renders the level + "what is missing" report (gaps present)', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify(PAYLOAD)))
    const res = runGoldAudit({ repo: '/tmp/x', class: 'gold' })
    expect(res.exitCode).toBe(0)
    const out = stdout()
    expect(out).toContain('gold-audit: L1 (gold)')
    expect(out).toContain("what's missing (1 family/families)")
    expect(out).toContain('N A-2 a two')
    expect(out).toContain('[README.md: missing install]') // evidence file + detail branch
  })

  it('human mode prints "nothing missing" when gaps is empty', () => {
    const clean: GoldAuditPayload = { ...PAYLOAD, gaps: [] }
    mockRunCli.mockReturnValue(ok(JSON.stringify(clean)))
    runGoldAudit({ repo: '/tmp/x', class: 'gold' })
    expect(stdout()).toContain("what's missing: nothing")
  })

  it('renders the no-next-level case (nextLevel null) with no "to" suffix', () => {
    const maxed: GoldAuditPayload = {
      ...PAYLOAD,
      level: { ...PAYLOAD.level, nextLevel: null, toNextLevel: 0 },
    }
    mockRunCli.mockReturnValue(ok(JSON.stringify(maxed)))
    runGoldAudit({ repo: '/tmp/x', class: 'gold' })
    const line = stdout().split('\n')[0]!
    expect(line).toContain('gold-audit: L1 (gold)')
    expect(line).not.toContain(' to ') // nextLevel null ⇒ no "· N to L2" suffix
  })

  it('renders a gap check with NO evidence (no bracket suffix branch)', () => {
    const noEv: GoldAuditPayload = {
      ...PAYLOAD,
      gaps: [
        {
          dimension: 'D-A',
          checks: [{ id: 'A-2', title: 'a two', verdict: 'N', anchor: null, evidence: null }],
        },
      ],
    }
    mockRunCli.mockReturnValue(ok(JSON.stringify(noEv)))
    runGoldAudit({ repo: '/tmp/x', class: 'gold' })
    const out = stdout()
    expect(out).toContain('N A-2 a two')
    expect(out).not.toContain('[') // no evidence ⇒ no [..] bracket
  })

  it('renders a gap check with detail-only evidence (file empty branch)', () => {
    const detailOnly: GoldAuditPayload = {
      ...PAYLOAD,
      gaps: [
        {
          dimension: 'D-A',
          checks: [
            {
              id: 'A-2',
              title: 'a two',
              verdict: 'P',
              anchor: null,
              evidence: { detail: 'partial' },
            },
          ],
        },
      ],
    }
    mockRunCli.mockReturnValue(ok(JSON.stringify(detailOnly)))
    runGoldAudit({ repo: '/tmp/x', class: 'gold' })
    expect(stdout()).toContain('[: partial]')
  })

  it('quiet suppresses all stdout but still returns the payload', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify(PAYLOAD)))
    const res = runGoldAudit({ repo: '/tmp/x', json: true, quiet: true, class: 'gold' })
    expect(res.payload).toBeTruthy()
    expect(stdout()).toBe('') // quiet ⇒ nothing printed
  })

  it('passes --stack through to the engine args', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify(PAYLOAD)))
    runGoldAudit({ repo: '/tmp/x', json: true, class: 'gold', stack: 'node' })
    const args = mockRunCli.mock.calls[0]![1] as string[]
    expect(args).toContain('--stack')
    expect(args).toContain('node')
  })

  it('defaults repo to cwd when no repo is given', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify(PAYLOAD)))
    runGoldAudit({ json: true, class: 'gold' })
    const callOpts = mockRunCli.mock.calls[0]![2] as { cwd: string }
    expect(callOpts.cwd).toBe(process.cwd())
  })
})

// ── SKIP (non-JSON stdout) branches ─────────────────────────────────────────────
describe('runGoldAudit SKIP (no registry)', () => {
  it('non-JSON stdout in human mode prints the trimmed skip line, exit 0, null payload', () => {
    mockRunCli.mockReturnValue(ok('gold-audit: SKIP — no registry at standards/gold-registry.yml\n'))
    const res = runGoldAudit({ repo: '/tmp/x', class: 'gold' })
    expect(res.exitCode).toBe(0)
    expect(res.payload).toBeNull()
    expect(stdout()).toContain('SKIP — no registry')
  })

  it('non-JSON stdout in json mode forwards the raw stdout', () => {
    mockRunCli.mockReturnValue(ok('gold-audit: SKIP — no registry\n'))
    const res = runGoldAudit({ repo: '/tmp/x', json: true })
    expect(res.exitCode).toBe(0)
    expect(stdout()).toContain('SKIP — no registry')
  })

  it('non-JSON stdout with quiet prints nothing', () => {
    mockRunCli.mockReturnValue(ok('gold-audit: SKIP\n'))
    const res = runGoldAudit({ repo: '/tmp/x', quiet: true })
    expect(res.exitCode).toBe(0)
    expect(stdout()).toBe('')
  })
})

// ── engine-failure / invalid-JSON branches ──────────────────────────────────────
describe('runGoldAudit error paths', () => {
  it('CliError from the engine ⇒ exit 1, null payload, message on stderr', () => {
    mockRunCli.mockImplementation(() => {
      throw cliErr({ exitCode: 1, stderr: 'boom' })
    })
    const res = runGoldAudit({ repo: '/tmp/x', json: true })
    expect(res.exitCode).toBe(1)
    expect(res.payload).toBeNull()
    expect(stderr()).toContain('gold-audit: engine failed')
  })

  it('a non-CliError thrown ⇒ String(err) fallback on stderr, exit 1', () => {
    mockRunCli.mockImplementation(() => {
      throw new Error('plain failure')
    })
    const res = runGoldAudit({ repo: '/tmp/x', json: true })
    expect(res.exitCode).toBe(1)
    expect(stderr()).toContain('plain failure')
  })

  it('engine emits JSON-looking-but-invalid output ⇒ exit 1 with parse error', () => {
    mockRunCli.mockReturnValue(ok('{not valid json'))
    const res = runGoldAudit({ repo: '/tmp/x', json: true })
    expect(res.exitCode).toBe(1)
    expect(res.payload).toBeNull()
    expect(stderr()).toContain('invalid JSON')
  })
})

// ── --check no-regress delegation (runGoldAuditCheck) ───────────────────────────
describe('runGoldAudit --check (#1419)', () => {
  it('engine success ⇒ exit 0 and forwards stdout + stderr', () => {
    mockRunCli.mockReturnValue(ok('gold-audit: baseline bootstrapped\n', 'note\n'))
    const res = runGoldAudit({ repo: '/tmp/x', check: true, class: 'gold' })
    expect(res.exitCode).toBe(0)
    expect(stdout()).toContain('baseline bootstrapped')
    expect(stderr()).toContain('note')
    // builds the --check args with --class
    const args = mockRunCli.mock.calls[0]![1] as string[]
    expect(args).toContain('--check')
    expect(args).toContain('--class')
  })

  it('requireBaseline + stack add --require-baseline and --stack to the args', () => {
    mockRunCli.mockReturnValue(ok(''))
    runGoldAudit({ repo: '/tmp/x', check: true, requireBaseline: true, stack: 'go' })
    const args = mockRunCli.mock.calls[0]![1] as string[]
    expect(args).toContain('--require-baseline')
    expect(args).toContain('--stack')
    expect(args).toContain('go')
  })

  it('CliError exit 1 (regress) ⇒ exit 1 and forwards engine stdout/stderr', () => {
    mockRunCli.mockImplementation(() => {
      throw cliErr({ exitCode: 1, stdout: 'REGRESS\n', stderr: 'detail\n' })
    })
    const res = runGoldAudit({ repo: '/tmp/x', check: true })
    expect(res.exitCode).toBe(1)
    expect(stdout()).toContain('REGRESS')
    expect(stderr()).toContain('detail')
  })

  it('CliError exit 2 (engine IO error) ⇒ exit 2', () => {
    mockRunCli.mockImplementation(() => {
      throw cliErr({ exitCode: 2, stderr: 'io\n' })
    })
    const res = runGoldAudit({ repo: '/tmp/x', check: true })
    expect(res.exitCode).toBe(2)
  })

  it('a non-CliError thrown in --check ⇒ exit 1 with String(err) on stderr', () => {
    mockRunCli.mockImplementation(() => {
      throw new Error('spawn died')
    })
    const res = runGoldAudit({ repo: '/tmp/x', check: true })
    expect(res.exitCode).toBe(1)
    expect(stderr()).toContain('spawn died')
  })

  it('CliError with empty stdout/stderr does not forward empty writes', () => {
    mockRunCli.mockImplementation(() => {
      throw cliErr({ exitCode: 1 })
    })
    const res = runGoldAudit({ repo: '/tmp/x', check: true })
    expect(res.exitCode).toBe(1)
    expect(stdout()).toBe('') // no stdout forwarded when CliError.stdout is empty
  })
})

// ── --cockpit / --ascii delegation (runGoldAuditCockpit) ─────────────────────────
describe('runGoldAudit --cockpit (#1475)', () => {
  it('renders the cockpit from a valid envelope (payload + freshness), exit 0', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify({ payload: PAYLOAD, freshness: FRESH })))
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true, class: 'gold' })
    expect(res.exitCode).toBe(0)
    expect(res.payload).toBeTruthy()
    const out = stdout()
    expect(out).toContain('DIMENSIONS')
    expect(out).toContain('L1 (gold)')
  })

  it('--ascii implies the cockpit and forces pure-ASCII output', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify({ payload: PAYLOAD, freshness: FRESH })))
    const res = runGoldAudit({ repo: '/tmp/x', ascii: true, class: 'gold' })
    expect(res.exitCode).toBe(0)
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(stdout())).toBe(false)
  })

  it('envelope without freshness ⇒ no banner, still exit 0', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify({ payload: PAYLOAD })))
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true, ascii: true })
    expect(res.exitCode).toBe(0)
    expect(stdout()).not.toContain('DATA')
  })

  it('quiet suppresses the cockpit render but returns the payload', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify({ payload: PAYLOAD, freshness: FRESH })))
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true, quiet: true })
    expect(res.payload).toBeTruthy()
    expect(stdout()).toBe('')
  })

  it('non-JSON stdout (SKIP) forwards the trimmed line, exit 0, null payload', () => {
    mockRunCli.mockReturnValue(ok('gold-audit: SKIP — no registry\n'))
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true })
    expect(res.exitCode).toBe(0)
    expect(res.payload).toBeNull()
    expect(stdout()).toContain('SKIP — no registry')
  })

  it('non-JSON stdout with quiet prints nothing (cockpit SKIP)', () => {
    mockRunCli.mockReturnValue(ok('gold-audit: SKIP\n'))
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true, quiet: true })
    expect(res.exitCode).toBe(0)
    expect(stdout()).toBe('')
  })

  it('engine CliError ⇒ exit 1 with the CliError message on stderr', () => {
    mockRunCli.mockImplementation(() => {
      throw cliErr({ exitCode: 1, stderr: 'engine boom' })
    })
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true })
    expect(res.exitCode).toBe(1)
    expect(res.payload).toBeNull()
    expect(stderr()).toContain('gold-audit: engine failed')
  })

  it('engine non-CliError ⇒ exit 1 with String(err) on stderr', () => {
    mockRunCli.mockImplementation(() => {
      throw 'raw string failure'
    })
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true })
    expect(res.exitCode).toBe(1)
    expect(stderr()).toContain('raw string failure')
  })

  it('invalid cockpit JSON ⇒ exit 1 with "invalid cockpit JSON" on stderr', () => {
    mockRunCli.mockReturnValue(ok('{ broken'))
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true })
    expect(res.exitCode).toBe(1)
    expect(res.payload).toBeNull()
    expect(stderr()).toContain('invalid cockpit JSON')
  })

  it('passes --stack through in cockpit mode', () => {
    mockRunCli.mockReturnValue(ok(JSON.stringify({ payload: PAYLOAD, freshness: FRESH })))
    runGoldAudit({ repo: '/tmp/x', cockpit: true, stack: 'python' })
    const args = mockRunCli.mock.calls[0]![1] as string[]
    expect(args).toContain('--cockpit-data')
    expect(args).toContain('--stack')
    expect(args).toContain('python')
  })

  it('a pathologically malformed payload that makes the renderer throw ⇒ exit 1, payload preserved', () => {
    // p.checks is not iterable in renderCockpit (for..of) ⇒ TypeError ⇒ caught defense-in-depth path.
    const broken = { payload: { ...PAYLOAD, checks: 42 } as unknown as GoldAuditPayload }
    mockRunCli.mockReturnValue(ok(JSON.stringify(broken)))
    const res = runGoldAudit({ repo: '/tmp/x', cockpit: true })
    expect(res.exitCode).toBe(1)
    expect(res.payload).toBeTruthy() // env.payload is returned even when render fails
    expect(stderr()).toContain('could not render cockpit')
  })
})
