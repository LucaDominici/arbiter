import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ArbiterConfigV2 } from '../config/schema.js'
import type { DecompositionBackend, WorkUnit, WorkUnitPhase, WorkUnitStatus } from './types.js'

const VALID_STATUSES = new Set<string>(['open', 'in_progress', 'blocked', 'done'])
const VALID_PHASES = new Set<string>([
  'preflight',
  'plan',
  'implementation',
  'verification',
  'complete',
])

function workDir(projectDir: string, config: ArbiterConfigV2): string {
  const sub = config.decomposition?.markdown?.dir ?? join('.arbiter', 'work')
  return join(projectDir, sub)
}

function idToFilename(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`
}

function serializeUnit(unit: WorkUnit): string {
  const lines = ['---']
  lines.push(`id: ${unit.id}`)
  lines.push(`title: ${escapeFrontMatterValue(unit.title)}`)
  lines.push(`status: ${unit.status}`)
  if (unit.phase) lines.push(`phase: ${unit.phase}`)
  if (unit.parent) lines.push(`parent: ${escapeFrontMatterValue(unit.parent)}`)
  if (unit.labels && unit.labels.length > 0) {
    lines.push(`labels: ${unit.labels.join(', ')}`)
  }
  lines.push('---')
  if (unit.body) {
    lines.push('')
    lines.push(unit.body)
  }
  return lines.join('\n') + '\n'
}

function escapeFrontMatterValue(v: string): string {
  if (v.includes('"') || v.includes(':') || v.includes('#') || v.includes('\n')) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  }
  return v
}

function parseFrontMatterValue(v: string): string {
  const trimmed = v.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
  }
  return trimmed
}

function parseUnit(content: string): WorkUnit | null {
  if (!content.startsWith('---')) return null

  const end = content.indexOf('\n---', 3)
  if (end === -1) return null

  const frontMatter = content.slice(3, end).trim()
  const body = content.slice(end + 4).trim() || undefined

  const fields: Record<string, string> = {}
  for (const line of frontMatter.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1)
    fields[key] = parseFrontMatterValue(val)
  }

  if (!fields['id'] || !fields['title'] || !fields['status']) return null

  const status = fields['status']
  if (!VALID_STATUSES.has(status)) return null

  const unit: WorkUnit = {
    id: fields['id'],
    title: fields['title'],
    status: status as WorkUnitStatus,
  }

  const phase = fields['phase']
  if (phase && VALID_PHASES.has(phase)) {
    unit.phase = phase as WorkUnitPhase
  }

  if (fields['parent']) unit.parent = fields['parent']

  const labels = fields['labels']
  if (labels) {
    unit.labels = labels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean)
  }

  if (body) unit.body = body

  return unit
}

function generateId(dir: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const prefix = `WU-${date}-`

  let maxN = 0
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.startsWith(prefix) || !f.endsWith('.md')) continue
      const n = parseInt(f.slice(prefix.length, -3), 10)
      if (!isNaN(n) && n > maxN) maxN = n
    }
  }

  return `${prefix}${maxN + 1}`
}

export class MarkdownBackend implements DecompositionBackend {
  readonly id = 'markdown' as const

  private readonly dir: string

  constructor(config: ArbiterConfigV2, projectDir?: string) {
    this.dir = workDir(projectDir ?? process.cwd(), config)
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true })
  }

  private filePath(unitId: string): string {
    return join(this.dir, idToFilename(unitId))
  }

  private readUnit(unitId: string): WorkUnit | null {
    const path = this.filePath(unitId)
    if (!existsSync(path)) return null
    const content = readFileSync(path, 'utf-8')
    return parseUnit(content)
  }

  private writeUnit(unit: WorkUnit): void {
    this.ensureDir()
    writeFileSync(this.filePath(unit.id), serializeUnit(unit))
  }

  list(filter?: { status?: WorkUnitStatus }): Promise<WorkUnit[]> {
    if (!existsSync(this.dir)) return Promise.resolve([])

    const units: WorkUnit[] = []
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.md')) continue
      const content = readFileSync(join(this.dir, file), 'utf-8')
      const unit = parseUnit(content)
      if (!unit) {
        process.stderr.write(`[arbiter] Warning: skipping malformed work unit: ${file}\n`)
        continue
      }
      if (filter?.status && unit.status !== filter.status) continue
      units.push(unit)
    }
    return Promise.resolve(units)
  }

  get(id: string): Promise<WorkUnit | null> {
    return Promise.resolve(this.readUnit(id))
  }

  create(input: Omit<WorkUnit, 'id'>): Promise<WorkUnit> {
    this.ensureDir()
    const id = generateId(this.dir)
    const unit: WorkUnit = { id, ...input }
    this.writeUnit(unit)
    return Promise.resolve(unit)
  }

  advance(id: string, phase: WorkUnitPhase): Promise<void> {
    const unit = this.readUnit(id)
    if (!unit) return Promise.reject(new Error(`Work unit "${id}" not found`))
    unit.phase = phase
    this.writeUnit(unit)
    return Promise.resolve()
  }

  close(id: string, opts?: { reason?: string }): Promise<void> {
    const unit = this.readUnit(id)
    if (!unit) return Promise.reject(new Error(`Work unit "${id}" not found`))
    unit.status = 'done'
    if (opts?.reason) {
      unit.body = unit.body ? `${unit.body}\n\nClosed: ${opts.reason}` : `Closed: ${opts.reason}`
    }
    this.writeUnit(unit)
    return Promise.resolve()
  }
}
