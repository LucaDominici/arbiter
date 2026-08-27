#!/usr/bin/env node
// Arbiter hook: phase-aware TDD evidence gate (#2383)
// Hook type: UserPromptSubmit — fires before every user prompt
// UserPromptSubmit runs before the assistant can invoke a skill, so this gate is retrospective:
// it blocks only after a successful implementation edit is already present in the transcript.
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { getRepoRoot } from './lib.mjs'

const IMPLEMENTATION_PHASES = new Set(['red', 'green', 'refactor'])
const KNOWN_PHASES = new Set([
  'preflight',
  'plan',
  'red-team-review',
  'red-team-rework',
  'red',
  'green',
  'refactor',
  'verification',
  'close',
  'complete',
])
const EDIT_TOOLS = new Set(['edit', 'write', 'notebookedit', 'multiedit'])
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024
const MAX_TRANSCRIPT_LINES = 100000
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

const root = getRepoRoot()
const input = readHookInput()
if (input === null) process.exit(0)
if (typeof input.session_id !== 'string' || !SESSION_ID.test(input.session_id)) {
  block('parseable hook input has no valid session_id')
}
const state = readPhaseState(root)
if (state.error) block(state.error)
if (typeof input.prompt === 'string' && input.prompt.trim() === '/tdd') process.exit(0)
if (!IMPLEMENTATION_PHASES.has(state.phase)) {
  if (state.phase === 'plan') {
    process.stdout.write('━━━ PLAN MODE — no file edits or code until human says GO ━━━\n')
  } else if (state.phase === 'verification') {
    process.stdout.write(
      '━━━ VERIFICATION MODE ━━━\n' +
        'Run the verification skill, then npm run test before committing.\n',
    )
  }
  process.exit(0)
}
const transcript = readTranscript(input, root)
if (transcript === null) process.exit(0)
const verdict = inspectTranscript(transcript, state.startedAt)
if (verdict.error) block(verdict.error)
if (!verdict.editObserved) process.exit(0)
if (!verdict.skillBeforeFirstEdit) {
  block(
    `phase ${state.phase} contains an implementation edit without a successful Skill(tdd) result before it`,
  )
}
process.exit(0)

function readHookInput() {
  let raw
  try {
    raw = readFileSync(0, 'utf-8')
  } catch {
    // FAIL-OPEN-INTENT: the host did not provide stdin, so no current-turn evidence can be read.
    return null
  }
  if (!raw.trim()) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // FAIL-OPEN-INTENT: non-JSON stdin is an unavailable Claude hook envelope.
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    block('parseable hook input is not an object')
  }
  return parsed
}

function readPhaseState(repoRoot) {
  const path = join(repoRoot, '.claude', '.task', 'status.json')
  if (!existsSync(path)) return { phase: 'unknown' }

  let state
  try {
    state = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { error: 'task state is unreadable; repair .claude/.task/status.json before editing' }
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { error: 'task state is not a JSON object; repair .claude/.task/status.json' }
  }

  const rawPhase = state.phase
  if (rawPhase === undefined || rawPhase === 'unknown') return { phase: 'unknown' }
  if (typeof rawPhase !== 'string') {
    return { error: 'task state phase is not a string; repair .claude/.task/status.json' }
  }
  const phase = rawPhase === 'implementation' ? 'red' : rawPhase
  // FAIL-OPEN-INTENT: a newer task phase is outside this hook's contract; the phase gate stands down
  // until the hook learns it, while the task/gate lifecycle remains authoritative.
  if (!KNOWN_PHASES.has(phase)) return { phase: 'unknown' }
  if (!IMPLEMENTATION_PHASES.has(phase)) return { phase }

  const timestamps = state.timestamps
  if (!timestamps || typeof timestamps !== 'object' || Array.isArray(timestamps)) {
    return { error: `task state has no timestamp for active phase ${phase}` }
  }
  const timestamp = timestamps[rawPhase] ?? timestamps[phase]
  const startedAt = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
  if (Number.isNaN(startedAt))
    return { error: `task state timestamp for phase ${phase} is invalid` }
  return { phase, startedAt }
}

function readTranscript(event, repoRoot) {
  const path = event.transcript_path
  if (typeof path !== 'string' || path.length === 0) {
    // FAIL-OPEN-INTENT: Claude may omit transcript_path on hosts without local transcript access.
    return null
  }
  if (!isAbsolute(path)) block('transcript_path must be absolute')

  const projectRoot = projectPath(event.cwd, repoRoot)
  const expectedDir = join(homedir(), '.claude', 'projects', encodeProjectPath(projectRoot))
  const expectedPath = join(expectedDir, `${event.session_id}.jsonl`)
  if (resolve(path) !== resolve(expectedPath) || basename(path) !== `${event.session_id}.jsonl`) {
    block('transcript_path is not the current session transcript for this project')
  }

  let raw
  try {
    const linkStat = lstatSync(path)
    if (!linkStat.isFile() || linkStat.isSymbolicLink())
      block('transcript_path must be a regular file')
    const canonical = realpathSync(path)
    if (canonical !== resolve(path)) block('transcript_path must not resolve through a symlink')
    const size = statSync(path).size
    if (size > MAX_TRANSCRIPT_BYTES) block(`transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes`)
    raw = readFileSync(path, 'utf-8')
  } catch (error) {
    if (error?.code === 'ELOOP') block('transcript_path contains a symlink loop')
    // FAIL-OPEN-INTENT: absent or unavailable host transcript cannot be correlated by this hook.
    return null
  }
  const lineCount = raw.split('\n').length
  if (lineCount > MAX_TRANSCRIPT_LINES) block(`transcript exceeds ${MAX_TRANSCRIPT_LINES} lines`)
  return raw
}

function projectPath(cwd, repoRoot) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return repoRoot
  try {
    const resolved = realpathSync(cwd)
    if (resolved === repoRoot || resolved.startsWith(`${repoRoot}${sep}`)) return resolved
  } catch {
    block('hook cwd is not a readable project directory')
  }
  block('hook cwd is outside the current repository')
}

function encodeProjectPath(path) {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

function inspectTranscript(raw, startedAt) {
  const lines = raw.split('\n')
  const lastNonEmpty = lines.reduce((last, line, index) => (line.trim() ? index : last), -1)
  const uses = new Map()
  const results = new Map()
  let sequence = 0

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].trim()
    if (!text) continue

    let record
    try {
      record = JSON.parse(text)
    } catch {
      if (index === lastNonEmpty) continue
      return { error: `transcript record ${index + 1} is malformed` }
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { error: `transcript record ${index + 1} is not an object` }
    }

    const content = record.message?.content
    if (!Array.isArray(content)) continue
    for (const blockValue of content) {
      if (!blockValue || typeof blockValue !== 'object' || Array.isArray(blockValue)) {
        return { error: `transcript record ${index + 1} contains an invalid content block` }
      }
      if (blockValue.type === 'tool_use') {
        if (record.message?.role !== 'assistant') {
          return {
            error: `transcript record ${index + 1} has a tool call outside an assistant message`,
          }
        }
        if (typeof blockValue.id !== 'string' || blockValue.id.trim() === '') {
          return { error: `transcript record ${index + 1} has a tool call without an id` }
        }
        if (typeof blockValue.name !== 'string' || blockValue.name.trim() === '') {
          return { error: `transcript record ${index + 1} has a tool call without a name` }
        }
        if (uses.has(blockValue.id)) return { error: `transcript repeats tool id ${blockValue.id}` }
        const tool = blockValue.name.toLowerCase()
        const timestamp = EDIT_TOOLS.has(tool) || tool === 'skill' ? parseTimestamp(record) : null
        if ((EDIT_TOOLS.has(tool) || tool === 'skill') && timestamp === null) {
          return { error: `transcript record ${index + 1} has an invalid tool timestamp` }
        }
        uses.set(blockValue.id, {
          tool,
          input: blockValue.input,
          timestamp,
          sequence,
        })
      } else if (blockValue.type === 'tool_result') {
        if (record.message?.role !== 'user') {
          return {
            error: `transcript record ${index + 1} has a tool result outside a user message`,
          }
        }
        if (typeof blockValue.tool_use_id !== 'string' || blockValue.tool_use_id.trim() === '') {
          return { error: `transcript record ${index + 1} has a tool result without an id` }
        }
        if (results.has(blockValue.tool_use_id)) {
          return { error: `transcript repeats result id ${blockValue.tool_use_id}` }
        }
        const use = uses.get(blockValue.tool_use_id)
        if (!use) return { error: `transcript result precedes or has no matching tool call` }
        if (blockValue.is_error !== undefined && typeof blockValue.is_error !== 'boolean') {
          return { error: `transcript result for ${blockValue.tool_use_id} has invalid is_error` }
        }
        results.set(blockValue.tool_use_id, {
          ok: blockValue.is_error !== true,
          sequence,
        })
      }
      sequence += 1
    }
  }

  const edits = []
  const skills = []
  for (const [id, use] of uses) {
    const result = results.get(id)
    if (!result || !result.ok || use.timestamp < startedAt) continue
    if (EDIT_TOOLS.has(use.tool)) edits.push(use)
    if (use.tool === 'skill' && use.input?.skill?.toLowerCase?.() === 'tdd') {
      skills.push(result)
    }
  }
  if (edits.length === 0) return { editObserved: false, skillBeforeFirstEdit: false }
  const firstEdit = edits.sort((a, b) => a.sequence - b.sequence)[0]
  return {
    editObserved: true,
    skillBeforeFirstEdit: skills.some((skill) => skill.sequence < firstEdit.sequence),
  }
}

function parseTimestamp(record) {
  if (typeof record.timestamp !== 'string') return null
  const timestamp = Date.parse(record.timestamp)
  return Number.isNaN(timestamp) ? null : timestamp
}

function block(reason) {
  process.stderr.write(
    `[skill-forced-eval] blocked: ${reason}\n` +
      'Run /tdd and wait for its successful result before editing implementation code.\n',
  )
  process.exit(2)
}
