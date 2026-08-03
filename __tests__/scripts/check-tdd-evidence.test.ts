// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  parseTaskIdsFromLog,
  parseTaskIdsFromBodies,
  touchesGovernedSource,
  hasSkipTrailer,
  formatSkipError,
  main,
} from '../../scripts/check-tdd-evidence.mjs'

describe('parseTaskIdsFromLog', () => {
  it('extracts task IDs from git log subject lines', () => {
    const log = [
      'feat(#551): add TDD evidence schema',
      'fix(#552): correct evidence path',
      'docs(#553): update AGENTS.md',
    ].join('\n')
    expect(parseTaskIdsFromLog(log)).toEqual(['#551', '#552', '#553'])
  })

  it('deduplicates task IDs appearing multiple times', () => {
    const log = ['feat(#551): first commit', 'fix(#551): follow-up commit'].join('\n')
    expect(parseTaskIdsFromLog(log)).toEqual(['#551'])
  })

  it('returns empty array when no task IDs found', () => {
    const log = 'chore: update deps\ndocs: fix typo'
    expect(parseTaskIdsFromLog(log)).toEqual([])
  })

  it('ignores lines that only mention IDs in body text without type prefix', () => {
    const log = 'feat(#551): fixes #552 and closes #553'
    // only #551 from the conventional commit prefix counts
    expect(parseTaskIdsFromLog(log)).toEqual(['#551'])
  })

  it('handles multiple IDs in a single commit subject (space-separated)', () => {
    const log = 'feat(#551 #552): x'
    expect(parseTaskIdsFromLog(log)).toEqual(['#551', '#552'])
  })

  it('extracts a task ID from a conventional-commit subject tail', () => {
    const log = 'feat(pr-tooling): merge-watch + capacity-probe + gate-exec advisory (#2098)'
    expect(parseTaskIdsFromLog(log)).toEqual(['#2098'])
  })

  it('does not extract IDs from non-conventional subjects', () => {
    expect(parseTaskIdsFromLog('chore: harvest PR #2101')).toEqual([])
  })

  it('does not extract IDs from reverted conventional-commit subjects', () => {
    expect(parseTaskIdsFromLog('Revert "feat(#123): x"')).toEqual([])
  })

  it('deduplicates task IDs across scope and subject-tail forms', () => {
    expect(parseTaskIdsFromLog('fix(#42): thing (#42)')).toEqual(['#42'])
  })
})

// ── #2217: the branch floor ───────────────────────────────────────────────────
// Task IDs in a commit SUBJECT are verified per commit. The repo convention for a
// commit without its own TDD cycle is `Refs #NNN` in the BODY — which parsed to zero
// IDs, so such a branch passed the gate VACUOUSLY no matter what it changed.

describe('parseTaskIdsFromBodies', () => {
  it('extracts ids from the Refs/Closes/Fixes family in a commit body', () => {
    const bodies = 'fix(cli): thing\n\nRefs #2218\n\x00chore: other\n\nCloses #2051\n\x00'
    expect(parseTaskIdsFromBodies(bodies)).toEqual(['#2218', '#2051'])
  })

  it('ignores bare issue mentions that are not a reference keyword', () => {
    expect(parseTaskIdsFromBodies('chore: harvest\n\nsee the discussion in PR #2101\n')).toEqual([])
  })

  it('deduplicates ids cited by several commits', () => {
    expect(parseTaskIdsFromBodies('a\n\nRefs #7\n\x00b\n\nrefs #7\n\x00')).toEqual(['#7'])
  })
})

describe('touchesGovernedSource', () => {
  it('is true for any change under src/, templates included', () => {
    expect(touchesGovernedSource('docs/x.md\nsrc/commands/task.ts')).toBe(true)
    expect(touchesGovernedSource('src/templates/scripts/check-all.mjs.ejs')).toBe(true)
  })

  it('is false for a branch that changes no source', () => {
    expect(touchesGovernedSource('docs/x.md\n__tests__/foo.test.ts\nREADME.md')).toBe(false)
    expect(touchesGovernedSource('')).toBe(false)
  })
})

describe('hasSkipTrailer', () => {
  it('returns true for ARBITER-SKIP-TDD: 1 trailer', () => {
    const body = 'feat(#551): some change\n\nARBITER-SKIP-TDD: 1\n'
    expect(hasSkipTrailer(body)).toBe(true)
  })

  it('returns false when trailer is absent', () => {
    const body = 'feat(#551): some change\n\nSigned-off-by: Dev <dev@example.com>\n'
    expect(hasSkipTrailer(body)).toBe(false)
  })

  it('returns false for partial match (not value 1)', () => {
    const body = 'feat(#551): change\n\nARBITER-SKIP-TDD: 0\n'
    expect(hasSkipTrailer(body)).toBe(false)
  })

  it('is case-sensitive — wrong case does not match', () => {
    const body = 'arbiter-skip-tdd: 1\n'
    expect(hasSkipTrailer(body)).toBe(false)
  })
})

describe('formatSkipError', () => {
  it('returns a non-empty error message containing the sha', () => {
    const msg = formatSkipError('abc1234', '#551')
    expect(msg).toContain('abc1234')
    expect(msg).toContain('#551')
    expect(msg.length).toBeGreaterThan(10)
  })
})

describe('main()', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function makeRun(responses: Map<string, string>) {
    return (_cmd: string, args: string[]) => {
      const key = args.join(' ')
      for (const [pattern, value] of responses) {
        if (key.includes(pattern)) return value
      }
      throw Object.assign(new Error(`unmocked git call: ${key}`), { stderr: '', stdout: '' })
    }
  }

  const exitFn = vi.fn()

  it('exits 0 vacuously when merge-base fails (no origin/main)', () => {
    exitFn.mockReset()
    const runFn = () => {
      throw new Error('no origin/main')
    }
    main({ runFn, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 0 when no task-ID commits found', () => {
    exitFn.mockReset()
    const responses = new Map([
      ['merge-base', 'deadbeef'],
      ['log', 'chore: update deps\ndocs: fix typo'],
      ['--format=%H', ''],
    ])
    main({ runFn: makeRun(responses) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 1 when skip trailer detected on a task commit', () => {
    exitFn.mockReset()
    const sha = 'a'.repeat(40)
    const bodyLog = `${sha}\nfeat(#551): add thing\n\nARBITER-SKIP-TDD: 1\n\x00`
    const responses = new Map([
      ['merge-base', 'deadbeef'],
      ['--format=%s', 'feat(#551): add thing'],
      ['--format=%H', bodyLog],
    ])
    main({ runFn: makeRun(responses) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(1)
  })

  it('exits 0 when ARBITER_SKIP_TDD=1 after trailer check passes', () => {
    exitFn.mockReset()
    vi.stubEnv('ARBITER_SKIP_TDD', '1')
    const responses = new Map([
      ['merge-base', 'deadbeef'],
      ['--format=%s', 'feat(#551): add thing'],
      ['--format=%H', ''],
    ])
    main({ runFn: makeRun(responses) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 0 when all task IDs verify PASS', () => {
    exitFn.mockReset()
    const responses = new Map([
      ['merge-base', 'deadbeef'],
      ['--format=%s', 'feat(#551): add thing'],
      ['--format=%H', ''],
      ['verify', 'PASS'],
    ])
    main({ runFn: makeRun(responses) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  // ── #2217: the branch floor ─────────────────────────────────────────────────
  const BODY_ONLY = `${'a'.repeat(40)}\nfix(cli): thing\n\nRefs #2218\n\x00`

  function floorRun(opts: { changed: string; verifyFails?: boolean; inherited?: boolean }) {
    return (_cmd: string, args: string[]) => {
      const key = args.join(' ')
      if (key.includes('merge-base')) return 'deadbeef'
      if (key.includes('--format=%s')) return 'fix(cli): thing'
      if (key.includes('--format=%H')) return BODY_ONLY
      if (key.includes('diff --name-only')) return opts.changed
      // "was this task's evidence produced on THIS branch?"
      if (key.includes('evidence/tdd')) return opts.inherited ? '' : 'c'.repeat(40)
      if (opts.verifyFails) {
        throw Object.assign(new Error('FAIL'), { stderr: 'evidence not found', stdout: '' })
      }
      return 'PASS'
    }
  }

  it('exits 0 when a body-refs branch touching src/ has verified evidence for a cited task', () => {
    exitFn.mockReset()
    main({ runFn: floorRun({ changed: 'src/cli.ts' }) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 1 when a body-refs branch touching src/ has no verified evidence at all', () => {
    exitFn.mockReset()
    main({
      runFn: floorRun({ changed: 'src/cli.ts', verifyFails: true }) as never,
      exitFn: exitFn as never,
    })
    expect(exitFn).toHaveBeenCalledWith(1)
  })

  // Without this, the floor is theatre: cite any long-closed task whose evidence sits on
  // main and the branch "proves" a red→green cycle it never ran.
  it('exits 1 when the only evidence for a cited task was inherited from main', () => {
    exitFn.mockReset()
    main({
      runFn: floorRun({ changed: 'src/cli.ts', inherited: true }) as never,
      exitFn: exitFn as never,
    })
    expect(exitFn).toHaveBeenCalledWith(1)
  })

  it('exits 0 for a body-refs branch that changes no source — docs stay vacuous', () => {
    exitFn.mockReset()
    main({ runFn: floorRun({ changed: 'docs/x.md' }) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  it('exits 1 when src/ changes cite no task at all, in subject or body', () => {
    exitFn.mockReset()
    const runFn = (_cmd: string, args: string[]) => {
      const key = args.join(' ')
      if (key.includes('merge-base')) return 'deadbeef'
      if (key.includes('--format=%s')) return 'chore: untraceable change'
      if (key.includes('--format=%H')) return `${'a'.repeat(40)}\nchore: untraceable change\n\x00`
      if (key.includes('diff --name-only')) return 'src/cli.ts'
      return 'PASS'
    }
    main({ runFn: runFn as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(1)
  })

  it('exits 1 when a task ID fails verification', () => {
    exitFn.mockReset()
    const runFn = (_cmd: string, args: string[]) => {
      const key = args.join(' ')
      if (key.includes('merge-base')) return 'deadbeef'
      if (key.includes('--format=%s')) return 'feat(#551): add thing'
      if (key.includes('--format=%H')) return ''
      // verify tdd → throw (simulates FAIL)
      throw Object.assign(new Error('FAIL'), { stderr: 'evidence not found', stdout: '' })
    }
    main({ runFn: runFn as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(1)
  })
})

// ── The gate, end to end, against a real branch (#2217) ───────────────────────
// Injected-runFn tests prove the decision logic; this proves the whole script —
// git queries included — on a synthetic branch shaped like the one that exposed
// the hole. Requires `--dir`, so the gate can be pointed at a repo that is not
// arbiter's own checkout.
describe('check-tdd-evidence.mjs --dir <repo>', () => {
  const repos: string[] = []
  afterEach(() => {
    for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  const GATE = resolve(new URL('../../scripts/check-tdd-evidence.mjs', import.meta.url).pathname)

  /** Repo with origin/main + one commit whose task id lives only in the body. */
  function seedRepo(changed: string): string {
    const repo = mkdtempSync(join(tmpdir(), 'tdd-gate-e2e-'))
    repos.push(repo)
    const g = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' })
    g(['init', '-b', 'main'])
    g(['config', 'user.email', ['tester', 'example.invalid'].join('@')])
    g(['config', 'user.name', 'tester'])
    g(['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(repo, 'README.md'), '# base\n')
    g(['add', '.'])
    g(['commit', '-m', 'chore: base'])
    g(['update-ref', 'refs/remotes/origin/main', 'HEAD'])

    mkdirSync(join(repo, join(changed, '..')), { recursive: true })
    writeFileSync(join(repo, changed), 'export const x = 1\n')
    g(['add', '.'])
    g(['commit', '-m', 'chore: tidy up'])
    return repo
  }

  function runGate(repo: string): { status: number | null; out: string } {
    const r = spawnSync('node', [GATE, '--dir', repo], { encoding: 'utf-8', timeout: 60_000 })
    return { status: r.status, out: `${r.stdout}${r.stderr}` }
  }

  it('fails a branch that changes src/ while citing no task id', () => {
    const { status, out } = runGate(seedRepo('src/thing.ts'))
    expect(status).toBe(1)
    expect(out).toMatch(/#2217/)
    expect(out).toMatch(/record-red/)
  })

  it('passes vacuously for a branch that changes no source', () => {
    const { status } = runGate(seedRepo('docs/note.md'))
    expect(status).toBe(0)
  })
})
