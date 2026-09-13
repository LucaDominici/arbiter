// SPDX-License-Identifier: Apache-2.0
// #2552: INV-91's AI-PR gate must fire on commit-trailer authorship, not just
// github.event.pull_request.user.type == 'Bot' — an agent driving a human
// token opens the PR as a User and the old condition never ran.
//
// This exercises the ACTUAL embedded `script:` body from the workflow files
// (extracted verbatim, not re-implemented) against commit messages read out of
// a real hermetic git repo, per the issue's own warning: a synthetic
// `user.type: Bot` payload proves nothing about the real failure mode.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SELF_WORKFLOW = resolve('.github/workflows/_ai-draft-check.yml')
const TEMPLATE_TWIN = resolve('src/templates/github/workflows/_ai-draft-check.yml.ejs')

function git(dir: string, args: string[]): string {
  const r = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'tester',
      GIT_AUTHOR_EMAIL: 'tester@example.com',
      GIT_COMMITTER_NAME: 'tester',
      GIT_COMMITTER_EMAIL: 'tester@example.com',
    },
  })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? ''}`)
  }
  return r.stdout ?? ''
}

function fixtureRepo(messages: string[]): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ai-pr-gate-'))
  git(dir, ['init', '-q'])
  // --allow-empty: only the commit MESSAGE (the trailer) matters to the gate,
  // so real file diffs are unnecessary weight, especially for the
  // >100-commit pagination-boundary fixture below.
  messages.forEach((msg) => {
    git(dir, ['commit', '-q', '--allow-empty', '-m', msg])
  })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// Extracts the `script: |` block body of the single job step in the workflow
// file, dedented, so the test runs the REAL gate source rather than a
// hand-rolled restatement of it.
function extractScriptBody(workflowPath: string): string {
  const src = readFileSync(workflowPath, 'utf-8')
  const marker = 'script: |\n'
  const start = src.indexOf(marker)
  if (start === -1) {
    throw new Error(`no 'script: |' block found in ${workflowPath}`)
  }
  const after = src.slice(start + marker.length)
  const lines = after.split('\n')
  const bodyLines: string[] = []
  const indent = lines[0].match(/^(\s*)/)?.[1] ?? ''
  for (const line of lines) {
    if (line.trim() !== '' && !line.startsWith(indent)) break
    bodyLines.push(line.startsWith(indent) ? line.slice(indent.length) : line)
  }
  return bodyLines.join('\n')
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// A `github.paginate` double that actually paginates: it drives the supplied
// `fn` (the octokit-shaped `listCommits`) page by page, honouring `per_page`,
// exactly like the real client does. A double that just returns the whole
// array in one call would let the script's `per_page: 100` argument rot
// unnoticed — this proves the pagination wiring, not just the trailer regex.
function makePaginatingGithub(commits: Array<{ commit: { message: string } }>) {
  const listCommits = async (params: { per_page?: number; page?: number }) => {
    const perPage = params.per_page ?? 30
    const page = params.page ?? 1
    const start = (page - 1) * perPage
    return { data: commits.slice(start, start + perPage) }
  }
  const paginate = async (
    fn: typeof listCommits,
    params: { per_page?: number },
  ): Promise<Array<{ commit: { message: string } }>> => {
    const perPage = params.per_page ?? 30
    let page = 1
    let all: Array<{ commit: { message: string } }> = []
    for (;;) {
      const { data } = await fn({ ...params, page })
      all = all.concat(data)
      if (data.length < perPage) break
      page += 1
    }
    return all
  }
  return { paginate, rest: { pulls: { listCommits } } }
}

async function runGate(
  workflowPath: string,
  opts: {
    commitMessages: string[]
    userType?: 'User' | 'Bot'
    userLogin?: string
    labels?: string[]
    apiError?: boolean
  },
): Promise<{ failed: string | null; infos: string[] }> {
  const body = extractScriptBody(workflowPath)
  const fixture = fixtureRepo(opts.commitMessages)
  try {
    const log = git(fixture.dir, ['log', '--format=%B%x00'])
      .split('\x00')
      .filter((s) => s.trim())
    const commits = log.map((message) => ({ commit: { message } }))

    let failed: string | null = null
    const infos: string[] = []
    const core = {
      setFailed: (msg: string) => {
        failed = msg
      },
      info: (msg: string) => infos.push(msg),
    }
    const github = opts.apiError
      ? {
          paginate: async () => {
            throw new Error('API rate limit exceeded')
          },
          rest: { pulls: { listCommits: async () => ({ data: [] }) } },
        }
      : makePaginatingGithub(commits)
    const context = {
      repo: { owner: 'acme', repo: 'widgets' },
      payload: {
        pull_request: {
          number: 1,
          user: { type: opts.userType ?? 'User', login: opts.userLogin ?? 'some-human' },
          labels: (opts.labels ?? []).map((name) => ({ name })),
        },
      },
    }

    const fn = new AsyncFunction('github', 'context', 'core', body)
    await fn(github, context, core)
    return { failed, infos }
  } finally {
    fixture.cleanup()
  }
}

describe.each([
  ['self workflow', SELF_WORKFLOW],
  ['template twin', TEMPLATE_TWIN],
])('%s — INV-91 fires on commit-trailer authorship (#2552)', (_label, workflowPath) => {
  it('a PR opened as a User whose commits carry a Claude Co-Authored-By trailer, without approval, fails', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['feat: add thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>'],
      userType: 'User',
      userLogin: 'a-human-token-holder',
      labels: [],
    })
    expect(result.failed).not.toBeNull()
  })

  it('the same trailer-bearing PR passes once approved-by-human is applied', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['feat: add thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>'],
      userType: 'User',
      userLogin: 'a-human-token-holder',
      labels: ['approved-by-human'],
    })
    expect(result.failed).toBeNull()
  })

  it('a PR with no AI-authorship signal at all passes without the label', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['feat: plain human commit, no trailer'],
      userType: 'User',
      userLogin: 'a-human',
      labels: [],
    })
    expect(result.failed).toBeNull()
  })

  it('dependabot[bot] is exempt even though it is a Bot account', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['chore(deps): bump foo from 1 to 2'],
      userType: 'Bot',
      userLogin: 'dependabot[bot]',
      labels: [],
    })
    expect(result.failed).toBeNull()
  })

  it('the ai-authored label is a manual override that forces the gate on with no trailer', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['feat: no trailer here'],
      userType: 'User',
      userLogin: 'a-human',
      labels: ['ai-authored'],
    })
    expect(result.failed).not.toBeNull()
  })

  it('a Codex-Session trailer also fires the gate (declared list is not Claude-only)', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['fix: bug\n\nCodex-Session: https://example.com/session/1'],
      userType: 'User',
      userLogin: 'a-human-token-holder',
      labels: [],
    })
    expect(result.failed).not.toBeNull()
  })

  it('a lowercase, extra-spaced trailer ("co-authored-by :") still fires the gate', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['fix: bug\n\nco-authored-by : Claude <noreply@anthropic.com>'],
      userType: 'User',
      userLogin: 'a-human-token-holder',
      labels: [],
    })
    expect(result.failed).not.toBeNull()
  })

  it('a mixed-case trailer with no space before the colon still fires the gate', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['fix: bug\n\nCO-AUTHORED-BY: CODEX <codex@example.com>'],
      userType: 'User',
      userLogin: 'a-human-token-holder',
      labels: [],
    })
    expect(result.failed).not.toBeNull()
  })

  it('an API error listing commits fails closed (requires the label) rather than passing silently', async () => {
    const result = await runGate(workflowPath, {
      commitMessages: ['feat: whatever'],
      userType: 'User',
      userLogin: 'a-human',
      labels: [],
      apiError: true,
    })
    expect(result.failed).not.toBeNull()
  })

  it('honours pagination: a trailer only on commit #101 (page 2 of a 100-per-page fetch) still fires', async () => {
    const commitMessages = Array.from({ length: 100 }, (_, i) => `chore: filler commit ${i}`)
    // git log lists newest-first, so the LAST commit made is the FIRST page's
    // first entry; put the trailer on the OLDEST commit so it only surfaces
    // once pagination walks past page 1's 100 entries.
    commitMessages.unshift('feat: agent change\n\nCo-Authored-By: Claude <noreply@anthropic.com>')
    const result = await runGate(workflowPath, {
      commitMessages,
      userType: 'User',
      userLogin: 'a-human-token-holder',
      labels: [],
    })
    expect(result.failed).not.toBeNull()
  })
})

describe('CANON-01 twin parity (#2552)', () => {
  it('self workflow and template twin embed byte-identical gate scripts', () => {
    expect(extractScriptBody(SELF_WORKFLOW)).toBe(extractScriptBody(TEMPLATE_TWIN))
  })
})
