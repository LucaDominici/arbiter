// SPDX-License-Identifier: Apache-2.0
import { runCli, runCliJson } from '../utils/run-cli.js'

export interface ProjectBoardResult {
  created: boolean
  projectUrl: string | null
  error: string | null
  warnings: string[]
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
  title: string,
  warnings: string[],
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
    const match = projects.find((p) => p.title === title)
    return match ? { number: match.number, url: match.url } : null
  } catch (err) {
    // #474: surface the error rather than returning null silently so the caller
    // can propagate the uncertainty (a transient failure here may leave the
    // create path unable to detect a pre-existing board → duplicate boards).
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`find-existing-board: ${msg}`)
    return null
  }
}

function existingFieldNames(
  owner: string,
  projectNumber: number,
  warnings: string[] = [],
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
    warnings.push(`existing-field-names(#${projectNumber}): ${msg}`)
    return new Set()
  }
}

interface FieldSpec {
  name: string
  options: string
}

function ensureField(
  projectNumber: number,
  owner: string,
  spec: FieldSpec,
  existingNames: Set<string>,
  warnings: string[],
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
    warnings.push(`${spec.name} field: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Create a GitHub Project board with standard fields (Priority, Size).
 * Idempotent: reuses an existing board with the same title rather than
 * creating a duplicate. Requires `gh` CLI with project scope.
 */
export function createProjectBoard(owner: string, repo: string): ProjectBoardResult {
  const boardTitle = `${repo} Board`
  const warnings: string[] = []

  const existing = findExistingBoard(owner, boardTitle, warnings)
  if (existing) {
    const fieldNames = existingFieldNames(owner, existing.number, warnings)
    ensureField(
      existing.number,
      owner,
      { name: 'Priority', options: 'P0,P1,P2' },
      fieldNames,
      warnings,
    )
    ensureField(existing.number, owner, { name: 'Size', options: 'XS,S,M,L' }, fieldNames, warnings)
    return { created: false, projectUrl: existing.url, error: null, warnings }
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
    return { created: false, projectUrl: null, error: msg, warnings: [] }
  }

  const fieldNames = existingFieldNames(owner, projectNumber, warnings)
  ensureField(projectNumber, owner, { name: 'Priority', options: 'P0,P1,P2' }, fieldNames, warnings)
  ensureField(projectNumber, owner, { name: 'Size', options: 'XS,S,M,L' }, fieldNames, warnings)

  return { created: true, projectUrl, error: null, warnings }
}
