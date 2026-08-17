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

  // #2313: kept identical to the SHIPPED predicate in
  // src/templates/scripts/check-tdd-evidence.mjs.ejs. A no-op for arbiter (single-module,
  // source is `src/`), but a divergence here is how the self-gate and the shipped gate
  // start meaning different things.
  it('is true for a nested module root (backend/src, frontend/src)', () => {
    expect(touchesGovernedSource('backend/src/main/java/App.java')).toBe(true)
    expect(touchesGovernedSource('frontend/src/App.vue')).toBe(true)
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
      // "was this task's evidence produced on THIS branch?" — checked before the
      // body-log pattern, which this query also matches.
      if (key.includes('evidence/tdd')) return opts.inherited ? '' : 'c'.repeat(40)
      if (key.includes('--format=%H')) return BODY_ONLY
      if (key.includes('diff --name-only')) return opts.changed
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

  // ── #2307: the produced-here guard on the SUBJECT path ──────────────────────
  // The floor above (#2217) required evidence to be PRODUCED on the branch, but only
  // when ids were cited in commit BODIES. A subject-cited id skipped the guard entirely:
  // `verify tdd`'s sha-on-branch check asserts only ANCESTRY, so once a task's evidence
  // is merged to main every later branch satisfies it. Citing a merged id in a subject
  // therefore passed the floor with no red→green cycle at all.
  //
  // Mock ORDER matters, as in floorRun: the produced-here query
  // (`git log --format=%H <base>..HEAD -- .arbiter/evidence/tdd/#NNN.json`) also matches
  // the `--format=%H` body-log pattern, so it must be matched FIRST or these tests pass
  // for the wrong reason.
  function subjectRun(opts: { changed: string; inherited?: boolean; bodyFresh?: boolean }) {
    const SUBJECT = 'fix(#2300): reuse an already-merged task id'
    return (_cmd: string, args: string[]) => {
      const key = args.join(' ')
      if (key.includes('merge-base')) return 'deadbeef'
      if (key.includes('--format=%s')) return SUBJECT
      if (key.includes('evidence/tdd')) {
        // #2401 stands for a body-cited task whose evidence IS produced here.
        if (key.includes('#2401')) return opts.bodyFresh ? 'c'.repeat(40) : ''
        return opts.inherited ? '' : 'c'.repeat(40)
      }
      if (key.includes('--format=%H')) return `${'a'.repeat(40)}\n${SUBJECT}\n\nRefs #2401\n\x00`
      if (key.includes('diff --name-only')) return opts.changed
      return 'PASS'
    }
  }

  // THE FALSIFIER (#2307): a branch citing a merged id in the SUBJECT, changing src/,
  // with no RED commit of its own, must exit non-zero. Before the fix this exited 0.
  it('exits 1 when a subject-cited id changes src/ but its evidence was inherited from main', () => {
    exitFn.mockReset()
    main({
      runFn: subjectRun({ changed: 'src/cli.ts', inherited: true }) as never,
      exitFn: exitFn as never,
    })
    expect(exitFn).toHaveBeenCalledWith(1)
  })

  // The other direction: a genuine red→green cycle on the subject path must still pass.
  // Trading blindness for a false red is not a fix.
  it('exits 0 when a subject-cited id changing src/ has evidence produced on this branch', () => {
    exitFn.mockReset()
    main({ runFn: subjectRun({ changed: 'src/cli.ts' }) as never, exitFn: exitFn as never })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  // The floor is owed per CHANGE, over subject ∪ body: a merge-train branch whose
  // subject cites a merged id but whose body cites a task with fresh on-branch evidence
  // has run a real cycle and must pass.
  it('exits 0 when the fresh evidence belongs to a body-cited id, not the subject id', () => {
    exitFn.mockReset()
    main({
      runFn: subjectRun({ changed: 'src/cli.ts', inherited: true, bodyFresh: true }) as never,
      exitFn: exitFn as never,
    })
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  // Gated on touchesGovernedSource, exactly as #2217 is. PR #2309 was docs-only with
  // #2307 in the subject; an ungated guard would have flipped it red.
  it('exits 0 for a docs-only branch citing a subject id with inherited evidence', () => {
    exitFn.mockReset()
    main({
      runFn: subjectRun({ changed: 'docs/runbook.md', inherited: true }) as never,
      exitFn: exitFn as never,
    })
    expect(exitFn).toHaveBeenCalledWith(0)
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

  // ── #2307, on a real branch ────────────────────────────────────────────────
  // The injected-runFn tests prove the decision logic; only real git proves the
  // plumbing, and branchFloor now runs `git diff --name-only` on the subject path where
  // it previously did not. Build the falsifier shape for real: evidence COMMITTED to
  // main (so it is tracked and an ancestor of every later branch), then a subject-cited
  // src/ change with no cycle of its own.
  function seedInheritedEvidenceRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'tdd-gate-inherit-'))
    repos.push(repo)
    const g = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' })
    g(['init', '-b', 'main'])
    g(['config', 'user.email', ['tester', 'example.invalid'].join('@')])
    g(['config', 'user.name', 'tester'])
    g(['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(repo, 'README.md'), '# base\n')
    g(['add', '.'])
    g(['commit', '-m', 'chore: base'])
    const rev = (ref: string) =>
      spawnSync('git', ['rev-parse', ref], { cwd: repo, encoding: 'utf-8' }).stdout.trim()
    const baseSha = rev('HEAD')
    const blobSha = rev('HEAD:README.md')

    // Evidence for #42 lands on main, exactly as a merged task's does.
    mkdirSync(join(repo, '.arbiter', 'evidence', 'tdd'), { recursive: true })
    writeFileSync(
      join(repo, '.arbiter', 'evidence', 'tdd', '#42.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#42',
        test_path: 'README.md',
        test_commit_sha: baseSha,
        test_blob_sha: blobSha,
        // verify tdd RE-RUNS this at test_commit_sha and requires the fresh output to
        // carry a recognised failure signature EQUAL to observed_failure (#1957). Emit
        // one directly: the point of this fixture is the produced-here guard, not the
        // re-execution check, which must PASS so the exit 1 is attributable.
        test_command: ['sh', '-c', 'echo " FAIL  __tests__/foo.test.ts"'],
        test_run_log:
          ' FAIL  __tests__/foo.test.ts > foo > does the thing\nexpected 1 to equal 2\n',
        observed_failure: 'FAIL  __tests__/foo.test.ts',
        recorded_at: '2026-01-01T00:00:00.000Z',
      }),
    )
    g(['add', '.arbiter'])
    g(['commit', '-m', 'chore: record evidence'])
    g(['update-ref', 'refs/remotes/origin/main', 'HEAD'])

    // The branch: cites the merged id in the SUBJECT, changes src/, runs no cycle.
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1\n')
    g(['add', '.'])
    g(['commit', '-m', 'fix(#42): reuse an already-merged task id'])
    return repo
  }

  it('fails a subject-cited src/ branch whose evidence was only inherited from main', () => {
    const { status, out } = runGate(seedInheritedEvidenceRepo())
    // Assert the REASON, not just the code: were verification to fail first, the gate
    // would also exit 1 and the test would prove nothing about the produced-here guard.
    expect(out).toMatch(/inherited from main/)
    expect(status).toBe(1)
  })
})
