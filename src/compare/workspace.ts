// SPDX-License-Identifier: Apache-2.0
/**
 * Workspace YAML spec loader (#264).
 *
 * Parses a minimal subset of YAML (no full parser dependency):
 *
 *   name: my-org
 *   repos:
 *     - path: ./my-app
 *       role: production
 *       tier: L3
 *
 * No external YAML library is used. The format is restricted enough that
 * a hand-rolled line scanner is sufficient and avoids a new runtime dep.
 */

import { readFileSync } from 'node:fs'
import type { WorkspaceSpec, WorkspaceRepo } from './model.js'

export type ParseWorkspaceOutcome =
  | { ok: true; spec: WorkspaceSpec }
  | { ok: false; reason: string }

/**
 * Parse a workspace YAML file.
 *
 * Supports only the keys documented in the spec: `name` (string) and
 * `repos` (list of objects with `path`, `role`, `tier`).
 */
export function parseWorkspaceFile(filePath: string): ParseWorkspaceOutcome {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err) {
    return {
      ok: false,
      reason: `failed to read workspace file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return parseWorkspaceYaml(raw, filePath)
}

/** Mutable internal accumulator — written to `current` during parsing. */
interface MutableRepoAccum {
  path?: string
  role?: string
  tier?: string
}

/** Parser state threaded through line processing. */
interface ParseState {
  name: string
  repos: WorkspaceRepo[]
  inRepos: boolean
  current: MutableRepoAccum | null
}

export function parseWorkspaceYaml(raw: string, source = '<input>'): ParseWorkspaceOutcome {
  const state: ParseState = { name: 'unknown', repos: [], inRepos: false, current: null }

  for (const rawLine of raw.split('\n')) {
    processLine(rawLine, state)
  }
  flushCurrent(state)

  if (state.repos.length === 0) {
    return { ok: false, reason: `${source}: no repos found in workspace spec` }
  }

  return { ok: true, spec: { name: state.name, repos: state.repos } }
}

function flushCurrent(state: ParseState): void {
  const c = state.current
  if (c !== null && typeof c.path === 'string') {
    const entry: WorkspaceRepo = { path: c.path }
    if (c.role !== undefined) (entry as { role?: string }).role = c.role
    if (c.tier !== undefined) (entry as { tier?: string }).tier = c.tier
    state.repos.push(entry)
    state.current = null
  }
}

function processLine(rawLine: string, state: ParseState): void {
  const line = rawLine.replace(/#.*$/, '').trimEnd()
  if (line.trim() === '') return

  const topMatch = line.match(/^(\w[\w-]*):\s*(.*)$/)
  if (topMatch !== null && !line.startsWith(' ') && !line.startsWith('\t')) {
    processTopLevel(topMatch, state)
    return
  }

  if (!state.inRepos) return
  processRepoLine(line, state)
}

function processTopLevel(topMatch: RegExpMatchArray, state: ParseState): void {
  const [, key, value] = topMatch
  if (key === 'name') {
    state.name = stripQuotes(value?.trim() ?? '')
    state.inRepos = false
  } else if (key === 'repos') {
    state.inRepos = true
  } else {
    state.inRepos = false
  }
  flushCurrent(state)
}

function processRepoLine(line: string, state: ParseState): void {
  const listItem = line.match(/^\s+-\s*(?:(.+))?$/)
  if (listItem !== null) {
    flushCurrent(state)
    state.current = {}
    const rest = listItem[1]?.trim() ?? ''
    if (rest !== '') {
      const kv = rest.match(/^(\w[\w-]*):\s*(.*)$/)
      if (kv !== null) assignField(state.current, kv[1] ?? '', stripQuotes(kv[2]?.trim() ?? ''))
    }
    return
  }
  if (state.current !== null) {
    const kv = line.match(/^\s+(\w[\w-]*):\s*(.*)$/)
    if (kv !== null) assignField(state.current, kv[1] ?? '', stripQuotes(kv[2]?.trim() ?? ''))
  }
}

function assignField(obj: MutableRepoAccum, key: string, value: string): void {
  if (key === 'path') obj.path = value
  else if (key === 'role') obj.role = value
  else if (key === 'tier') obj.tier = value
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}
