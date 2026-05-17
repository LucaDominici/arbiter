// SPDX-License-Identifier: Apache-2.0
import { loadConfig } from '../utils/config.js'
import type { ArbiterConfigV2 } from '../config/schema.js'
import { getBackend } from '../decomposition/registry.js'
import type { WorkUnitStatus, WorkUnitPhase } from '../decomposition/types.js'
import { ArbiterError } from '../utils/errors.js'
import { t } from '../i18n/index.js'

export interface WorkListOptions {
  dir?: string
  status?: WorkUnitStatus
}

export interface WorkCreateOptions {
  dir?: string
  title: string
  body?: string
  labels?: string[]
}

export interface WorkShowOptions {
  dir?: string
  id: string
}

export interface WorkCloseOptions {
  dir?: string
  id: string
  reason?: string
}

export interface WorkAdvanceOptions {
  dir?: string
  id: string
  phase: WorkUnitPhase
}

function resolveDir(dir?: string): string {
  return dir ?? process.cwd()
}

function requireConfig(targetDir: string): ArbiterConfigV2 {
  const config = loadConfig(targetDir)
  if (!config) {
    throw ArbiterError.fromKey(
      'E_CONFIG_NOT_FOUND',
      'errors.E_CONFIG_NOT_FOUND',
      {},
      {
        hint: 'Run `arbiter init` to initialize governance in this directory.',
        docUrl: 'https://arbiter.dev/reference/cli#init',
      },
    )
  }
  return config
}

export async function runWorkList(opts: WorkListOptions): Promise<void> {
  const targetDir = resolveDir(opts.dir)
  const config = requireConfig(targetDir)
  const backend = getBackend(config, targetDir)
  const units = await backend.list(opts.status ? { status: opts.status } : undefined)

  if (units.length === 0) {
    console.log(t('cli.work.no_units'))
    return
  }

  for (const unit of units) {
    const phase = unit.phase ? ` [${unit.phase}]` : ''
    const labels = unit.labels && unit.labels.length > 0 ? ` (${unit.labels.join(', ')})` : ''
    console.log(
      t('cli.work.unit_row', {
        id: unit.id,
        status: unit.status,
        phase,
        title: unit.title,
        labels,
      }),
    )
  }
}

export async function runWorkCreate(opts: WorkCreateOptions): Promise<void> {
  const targetDir = resolveDir(opts.dir)
  const config = requireConfig(targetDir)
  const backend = getBackend(config, targetDir)
  const unit = await backend.create({
    title: opts.title,
    status: 'open',
    ...(opts.body ? { body: opts.body } : {}),
    ...(opts.labels ? { labels: opts.labels } : {}),
  })
  console.log(t('cli.work.created', { id: unit.id, title: unit.title }))
}

export async function runWorkShow(opts: WorkShowOptions): Promise<void> {
  const targetDir = resolveDir(opts.dir)
  const config = requireConfig(targetDir)
  const backend = getBackend(config, targetDir)
  const unit = await backend.get(opts.id)

  if (!unit) {
    throw ArbiterError.fromKey(
      'E_WORK_NOT_FOUND',
      'errors.E_WORK_NOT_FOUND',
      { id: opts.id },
      {
        hint: 'Run `arbiter work list` to see available work unit IDs.',
      },
    )
  }

  console.log(t('cli.work.show.id', { id: unit.id }))
  console.log(t('cli.work.show.title', { title: unit.title }))
  console.log(t('cli.work.show.status', { status: unit.status }))
  if (unit.phase) console.log(t('cli.work.show.phase', { phase: unit.phase }))
  if (unit.parent) console.log(t('cli.work.show.parent', { parent: unit.parent }))
  if (unit.labels && unit.labels.length > 0) {
    console.log(t('cli.work.show.labels', { labels: unit.labels.join(', ') }))
  }
  if (unit.body) {
    console.log()
    console.log(unit.body)
  }
}

export async function runWorkClose(opts: WorkCloseOptions): Promise<void> {
  const targetDir = resolveDir(opts.dir)
  const config = requireConfig(targetDir)
  const backend = getBackend(config, targetDir)
  await backend.close(opts.id, opts.reason ? { reason: opts.reason } : undefined)
  console.log(t('cli.work.closed', { id: opts.id }))
}

export async function runWorkAdvance(opts: WorkAdvanceOptions): Promise<void> {
  const targetDir = resolveDir(opts.dir)
  const config = requireConfig(targetDir)
  const backend = getBackend(config, targetDir)
  await backend.advance(opts.id, opts.phase)
  console.log(t('cli.work.advanced', { id: opts.id, phase: opts.phase }))
}
