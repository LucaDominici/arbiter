// SPDX-License-Identifier: Apache-2.0
import { runCli, runCliJson } from '../utils/run-cli.js'
import { classifyGhError, type GhErrorKind } from './classify-gh-error.js'

export interface ProjectBoardError {
  message: string
  kind: GhErrorKind
}

export interface ProjectBoardResult {
  created: boolean
  projectUrl: string | null
  error: string | null
  errorKind?: GhErrorKind
  warnings: string[]
  classifiedErrors: ProjectBoardError[]
}

interface GhProject {
  number: number
  title: string
  url: string
}

interface GhField {
  name: string
}

function findExistingBoard(
  owner: string,
  prefix: string,
  warnings: string[],
  classifiedErrors: ProjectBoardError[],
): { number: number; url: string } | null {
  try {
    const raw = runCliJson('gh', [
      'project',
      'list',
      '--owner',
      owner,
      '--format',
      'json',
      '--limit',
      '100',
    ])
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`Unexpected gh project list output: expected object with "projects" key`)
    }
    const rawObj = raw as Record<string, unknown>
    if (!Array.isArray(rawObj['projects'])) {
      throw new Error(`Unexpected gh project list output: "projects" field is not an array`)
    }
    const projects = rawObj['projects'] as GhProject[]
    const match = projects.find((p) => p.title === prefix || p.title.startsWith(prefix + ' · '))
    return match ? { number: match.number, url: match.url } : null
  } catch (err) {
    // #474: surface the error rather than returning null silently so the caller
    // can propagate the uncertainty (a transient failure here may leave the
    // create path unable to detect a pre-existing board → duplicate boards).
    const msg = err instanceof Error ? err.message : String(err)
    const kind = classifyGhError(err)
    warnings.push(`find-existing-board: ${msg}`)
    classifiedErrors.push({ message: `find-existing-board: ${msg}`, kind })
    return null
  }
}

function existingFieldNames(
  owner: string,
  projectNumber: number,
  warnings: string[],
  classifiedErrors: ProjectBoardError[],
): Set<string> {
  try {
    const raw = runCliJson('gh', [
      'project',
      'field-list',
      String(projectNumber),
      '--owner',
      owner,
      '--format',
      'json',
    ])
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`Unexpected gh project field-list output: expected object with "fields" key`)
    }
    const rawObj = raw as Record<string, unknown>
    if (!Array.isArray(rawObj['fields'])) {
      throw new Error(`Unexpected gh project field-list output: "fields" field is not an array`)
    }
    const fields = rawObj['fields'] as GhField[]
    return new Set(fields.map((f) => f.name))
  } catch (err) {
    // #492: surface the error rather than swallowing it. Without this, malformed
    // gh field-list output causes every Priority/Size field to be treated as
    // missing, leading to duplicate field-create attempts the caller cannot
    // distinguish from a benign empty board.
    const msg = err instanceof Error ? err.message : String(err)
    const kind = classifyGhError(err)
    warnings.push(`existing-field-names(#${projectNumber}): ${msg}`)
    classifiedErrors.push({ message: `existing-field-names(#${projectNumber}): ${msg}`, kind })
    return new Set()
  }
}

interface FieldSpec {
  name: string
  options: string
}

interface ErrorAccum {
  warnings: string[]
  classifiedErrors: ProjectBoardError[]
}

function ensureField(
  projectNumber: number,
  owner: string,
  spec: FieldSpec,
  existingNames: Set<string>,
  accum: ErrorAccum,
): void {
  if (existingNames.has(spec.name)) return
  try {
    runCli('gh', [
      'project',
      'field-create',
      String(projectNumber),
      '--owner',
      owner,
      '--name',
      spec.name,
      '--data-type',
      'SINGLE_SELECT',
      '--single-select-options',
      spec.options,
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const kind = classifyGhError(err)
    accum.warnings.push(`${spec.name} field: ${msg}`)
    accum.classifiedErrors.push({ message: `${spec.name} field: ${msg}`, kind })
  }
}

/**
 * Create a GitHub Project board with standard fields (Priority, Size).
 * Idempotent: reuses an existing board whose title matches the
 * `${projectName} Board · ${owner}/${repo}` prefix (date-agnostic probe).
 * Requires `gh` CLI with project scope.
 */
export function createProjectBoard(
  owner: string,
  repo: string,
  projectName: string,
): ProjectBoardResult {
  if (!projectName) {
    return {
      created: false,
      projectUrl: null,
      error: 'projectName must not be empty',
      warnings: [],
      classifiedErrors: [],
    }
  }

  const prefix = `${projectName} Board · ${owner}/${repo}`
  const utcDate = new Date().toISOString().slice(0, 10)
  const boardTitle = `${prefix} · ${utcDate}`
  const warnings: string[] = []
  const classifiedErrors: ProjectBoardError[] = []

  const accum: ErrorAccum = { warnings, classifiedErrors }
  const existing = findExistingBoard(owner, prefix, warnings, classifiedErrors)
  if (existing) {
    const fieldNames = existingFieldNames(owner, existing.number, warnings, classifiedErrors)
    ensureField(
      existing.number,
      owner,
      { name: 'Priority', options: 'P0,P1,P2' },
      fieldNames,
      accum,
    )
    ensureField(existing.number, owner, { name: 'Size', options: 'XS,S,M,L' }, fieldNames, accum)
    return { created: false, projectUrl: existing.url, error: null, warnings, classifiedErrors }
  }

  let projectNumber: number
  let projectUrl: string
  try {
    const raw = runCliJson('gh', [
      'project',
      'create',
      '--owner',
      owner,
      '--title',
      boardTitle,
      '--format',
      'json',
    ])
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`Unexpected gh project create output: expected object`)
    }
    const rawObj = raw as Record<string, unknown>
    if (typeof rawObj['number'] !== 'number' || typeof rawObj['url'] !== 'string') {
      throw new Error(`Unexpected gh project create output: missing "number" or "url" fields`)
    }
    projectNumber = rawObj['number']
    projectUrl = rawObj['url']
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const kind = classifyGhError(err)
    classifiedErrors.push({ message: msg, kind })
    return {
      created: false,
      projectUrl: null,
      error: msg,
      errorKind: kind,
      warnings,
      classifiedErrors,
    }
  }

  const fieldNames = existingFieldNames(owner, projectNumber, warnings, classifiedErrors)
  ensureField(projectNumber, owner, { name: 'Priority', options: 'P0,P1,P2' }, fieldNames, accum)
  ensureField(projectNumber, owner, { name: 'Size', options: 'XS,S,M,L' }, fieldNames, accum)

  return { created: true, projectUrl, error: null, warnings, classifiedErrors }
}
