// SPDX-License-Identifier: Apache-2.0
/**
 * Measures a KIT catalog dimension against the actual repo state.
 *
 * Evidence paths are POSIX-relative (no leading slash, no backslashes),
 * sorted lexicographically, deduplicated — deterministic across repeated calls.
 *
 * Issue: #1043
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { KitDimension } from './schema.js'

export interface MeasureResult {
  status: 'present' | 'partial' | 'missing'
  evidence: string[]
}

function toPosixRelative(repoRoot: string, absPath: string): string {
  return relative(repoRoot, absPath).replace(/\\/g, '/')
}

function globWorkflows(repoRoot: string): string[] {
  const dir = join(repoRoot, '.github', 'workflows')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort()
      .map((f) => toPosixRelative(repoRoot, join(dir, f)))
  } catch {
    return []
  }
}

function measureCiCd(repoRoot: string): MeasureResult {
  const workflows = globWorkflows(repoRoot)
  if (workflows.length === 0) return { status: 'missing', evidence: [] }
  return { status: 'present', evidence: workflows }
}

export function measureDim(dim: KitDimension, repoRoot: string): MeasureResult {
  if (!existsSync(repoRoot)) return { status: 'missing', evidence: [] }

  try {
    if (dim.categoryRef === 'ci-cd') return measureCiCd(repoRoot)
    return { status: 'missing', evidence: [] }
  } catch {
    return { status: 'missing', evidence: [] }
  }
}
