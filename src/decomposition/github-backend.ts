// SPDX-License-Identifier: Apache-2.0
import { runCli, runCliJson, CliError } from '../utils/run-cli.js'
import type { ArbiterConfigV2 } from '../config/schema.js'
import type { DecompositionBackend, WorkUnit, WorkUnitPhase, WorkUnitStatus } from './types.js'

interface GhIssue {
  number: number
  title: string
  state: string
  body?: string | null
  labels: Array<{ name: string }>
}

function ghStateToStatus(state: string): WorkUnitStatus {
  const s = state.toUpperCase()
  if (s === 'CLOSED') return 'done'
  return 'open'
}

function statusToGhState(status: WorkUnitStatus): string {
  if (status === 'done') return 'closed'
  if (status === 'open') return 'open'
  throw new Error(
    `GitHub backend does not support filtering by status "${status}". Use "open" or "done".`,
  )
}

function mapIssue(issue: GhIssue): WorkUnit {
  const unit: WorkUnit = {
    id: `#${issue.number}`,
    title: issue.title,
    status: ghStateToStatus(issue.state),
    labels: issue.labels.map((l) => l.name),
  }
  if (issue.body) unit.body = issue.body
  return unit
}

/**
 * Validate one element of `gh issue {view,list}` JSON before it is trusted as a
 * {@link GhIssue}. `runCliJson` returns `unknown` precisely so callers narrow it;
 * a blind `as GhIssue` cast would let a `gh` schema change or partial object
 * surface as a cryptic `Cannot read properties of undefined` deep inside `.map`.
 * Mirrors the defensive pattern in `src/github/labels.ts`. (#1536)
 */
function assertGhIssue(value: unknown, ctx: string): GhIssue {
  if (typeof value !== 'object' || value === null) {
    throw new Error(
      `Unexpected ${ctx} output: expected object, got ${value === null ? 'null' : typeof value}`,
    )
  }
  const obj = value as Record<string, unknown>
  if (typeof obj['number'] !== 'number') {
    throw new Error(`Unexpected ${ctx} output: missing numeric "number" field`)
  }
  if (typeof obj['title'] !== 'string') {
    throw new Error(`Unexpected ${ctx} output: missing string "title" field`)
  }
  if (typeof obj['state'] !== 'string') {
    throw new Error(`Unexpected ${ctx} output: missing string "state" field`)
  }
  if (!Array.isArray(obj['labels'])) {
    throw new Error(`Unexpected ${ctx} output: "labels" field is not an array`)
  }
  obj['labels'].forEach((label, i) => {
    if (
      typeof label !== 'object' ||
      label === null ||
      typeof (label as Record<string, unknown>)['name'] !== 'string'
    ) {
      throw new Error(`Unexpected ${ctx} output: label[${i}] is missing a string "name" field`)
    }
  })
  return value as GhIssue
}

/** Validate the array wrapper of `gh issue list` JSON, then each element. (#1536) */
function parseGhIssueList(raw: unknown): GhIssue[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `Unexpected gh issue list output: expected array, got ${raw === null ? 'null' : typeof raw}`,
    )
  }
  return raw.map((item, i) => assertGhIssue(item, `gh issue list[${i}]`))
}

function stripHash(id: string): string {
  return id.startsWith('#') ? id.slice(1) : id
}

export class GitHubBackend implements DecompositionBackend {
  readonly id = 'github' as const

  private readonly _owner: string | null
  private readonly _repo: string | null

  constructor(config: ArbiterConfigV2) {
    this._owner = config.decomposition?.github?.owner ?? null
    this._repo = config.decomposition?.github?.repo ?? null
  }

  private repoCoords(): { owner: string; repo: string } {
    if (!this._owner || !this._repo) {
      const result = runCliJson('gh', ['repo', 'view', '--json', 'nameWithOwner'], {})
      if (
        typeof result !== 'object' ||
        result === null ||
        typeof (result as Record<string, unknown>)['nameWithOwner'] !== 'string'
      ) {
        throw new Error('Unexpected gh repo view output: missing string "nameWithOwner" field')
      }
      const nameWithOwner = (result as Record<string, unknown>)['nameWithOwner'] as string
      const parts = nameWithOwner.split('/')
      const owner = parts[0] ?? ''
      const repo = parts[1] ?? ''
      return { owner, repo }
    }
    return { owner: this._owner, repo: this._repo }
  }

  private repoFlag(): string {
    const { owner, repo } = this.repoCoords()
    return `${owner}/${repo}`
  }

  list(filter?: { status?: WorkUnitStatus }): Promise<WorkUnit[]> {
    try {
      if (filter?.status && filter.status !== 'open' && filter.status !== 'done') {
        throw new Error(
          `GitHub backend does not support filtering by status "${filter.status}". Use "open" or "done".`,
        )
      }

      const args = [
        'issue',
        'list',
        '-R',
        this.repoFlag(),
        '--json',
        'number,title,state,body,labels',
        '--limit',
        '200',
      ]

      if (filter?.status) {
        args.push('--state', statusToGhState(filter.status))
      }

      // parseGhIssueList throws on malformed gh JSON — surface it as a rejected
      // promise (rather than a synchronous throw) so callers can `await` it.
      const issues = parseGhIssueList(runCliJson('gh', args, {}))
      return Promise.resolve(issues.map(mapIssue))
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  get(id: string): Promise<WorkUnit | null> {
    const num = stripHash(id)
    try {
      const issue = assertGhIssue(
        runCliJson(
          'gh',
          ['issue', 'view', num, '-R', this.repoFlag(), '--json', 'number,title,state,body,labels'],
          {},
        ),
        'gh issue view',
      )
      return Promise.resolve(mapIssue(issue))
    } catch (err) {
      if (err instanceof CliError && !err.notFound && !err.timedOut) {
        // gh returned an error (e.g. issue does not exist) but did not time out
        // and the binary was found — treat as absent item, not a network failure.
        return Promise.resolve(null)
      }
      // timedOut (network failure) or binary-not-found → propagate so callers
      // can distinguish infrastructure failure from a genuinely absent item.
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  create(input: Omit<WorkUnit, 'id'>): Promise<WorkUnit> {
    const args = ['issue', 'create', '-R', this.repoFlag(), '--title', input.title]

    if (input.body) args.push('--body', input.body)
    if (input.labels && input.labels.length > 0) {
      args.push('--label', input.labels.join(','))
    }

    const result = runCli('gh', args, {})
    const match = /\/issues\/(\d+)/.exec(result.stdout.trim())
    if (match === null || match[1] === undefined) {
      return Promise.reject(
        new Error(`gh issue create returned unexpected output: ${result.stdout.trim()}`),
      )
    }
    const num = parseInt(match[1], 10)
    const unit: WorkUnit = {
      id: `#${num}`,
      title: input.title,
      status: input.status,
    }
    if (input.phase) unit.phase = input.phase
    if (input.parent) unit.parent = input.parent
    if (input.body) unit.body = input.body
    if (input.labels) unit.labels = input.labels
    return Promise.resolve(unit)
  }

  async advance(id: string, phase: WorkUnitPhase): Promise<void> {
    const num = stripHash(id)
    const phaseLabel = `phase/${phase}`

    const existing = await this.get(id)
    if (!existing) throw new Error(`Work unit "${id}" not found`)

    const oldPhaseLabels = (existing.labels ?? []).filter((l) => l.startsWith('phase/'))

    const editArgs = ['issue', 'edit', num, '-R', this.repoFlag(), '--add-label', phaseLabel]

    if (oldPhaseLabels.length > 0) {
      editArgs.push('--remove-label', oldPhaseLabels.join(','))
    }

    runCli('gh', editArgs, {})
  }

  close(id: string, opts?: { reason?: string }): Promise<void> {
    const num = stripHash(id)
    const args = ['issue', 'close', num, '-R', this.repoFlag()]

    if (opts?.reason) {
      args.push('--comment', `Closed: ${opts.reason}`)
    }

    runCli('gh', args, {})
    return Promise.resolve()
  }
}
