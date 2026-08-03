// SPDX-License-Identifier: Apache-2.0
//
// #2162 — `arbiter doctor fail-open-census`: scans a target's `scripts/` and
// `.githooks/` (the bash/gate-script surfaces) for the `command -v X ||
// <fail-open>` and positive `if command -v X; then ... fi` presence-gate
// anti-patterns. Motivating field evidence: 13
// censused points where a gate silently skips on an absent binary — including
// one that disarms itself on a `gh auth status` token expiry.
//
// Non-goal, cited per the issue: `scripts/check-fail-closed-audit.mjs` is a
// different pattern class (`|| true`, swallowed `catch {}`, missing
// `set -euo pipefail`) self-scoped to arbiter's OWN repo (hardcoded SCAN_DIRS,
// `src/` included) — not the `command -v` presence-gate pattern censused here,
// and not reusable for an arbitrary target. This is a small dedicated scanner.
//
// Read-only by construction (AC-4): only `readFileSync`/`readdirSync`. No
// `--update-allowlist` write flag — the allowlist is hand-authored.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { jsonOutput } from '../../utils/json-output.js'

export interface FailOpenFinding {
  file: string
  line: number
  tool: string
  /** Set to the allowlist entry's reason when this finding is suppressed. */
  allowlisted?: string
}

export interface DoctorFailOpenCensusOptions {
  dir?: string
  json?: boolean
  allowlistPath?: string
}

export interface DoctorFailOpenCensusResult {
  /** 2 = malformed allowlist entry (missing reason); 1 = unsuppressed finding; 0 = clean. */
  exitCode: 0 | 1 | 2
  findings: FailOpenFinding[]
}

const SCAN_SUBDIRS = ['scripts', '.githooks']
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'data'])

function listScanFiles(dir: string): string[] {
  const out: string[] = []
  for (const sub of SCAN_SUBDIRS) {
    walk(join(dir, sub), out)
  }
  return out
}

function walk(current: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(current)
    // FAIL-OPEN-INTENT: subdir absent (e.g. no .githooks/) — zero findings, not an audit failure.
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(current, entry)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(full)
      // FAIL-OPEN-INTENT: TOCTOU race or dangling symlink — skip this entry, scan the rest.
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry)) continue
      walk(full, out)
    } else if (stat.isFile()) {
      out.push(full)
    }
  }
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

// Detector 1: brace form — `command -v X ... || { ... return|exit 0 ... }`.
const BRACE_FORM_RE = /command\s+-v\s+(\S+)[^\n]*\|\|\s*\{[^}]*\b(?:return|exit)\s+0\b/g

// Detector 2: bare form — `command -v X ... || exit 0`.
const BARE_FORM_RE = /command\s+-v\s+(\S+)[^\n]*\|\|\s*exit\s+0\b/g

// Detector 3: `if ! command -v X` guard form — opens a block scanned forward
// for `return 0`/`exit 0` before the matching `fi` (simple depth counter).
const IF_GUARD_RE = /if\s*!\s*command\s+-v\s+(\S+)/g

// Detector 4: positive `if command -v X` guard form — skips blocking work when absent, except when an else performs fallback work.
const POSITIVE_IF_GUARD_RE = /(?<!el)\bif\s+command\s+-v\s+(\S+)/g

function findMatchingFi(lines: string[], startLine: number): number {
  let depth = 1
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/\bif\b(?!\s*!\s*command)/.test(line) && /;\s*then\s*$|then\s*$/.test(line)) depth++
    if (/(?:^|[;\s])fi(?:[;\s]|$)/.test(line)) {
      depth--
      if (depth === 0) return i
    }
  }
  return lines.length - 1
}

function findGuardFindings(
  text: string,
  file: string,
  re: RegExp,
  isFailOpen: (blockLines: string[]) => boolean,
): FailOpenFinding[] {
  const lines = text.split('\n')
  const findings: FailOpenFinding[] = []
  for (const m of text.matchAll(re)) {
    const tool = m[1]
    if (!tool) continue
    const startLine = lineOf(text, m.index)
    const blockStartIdx = startLine
    const fiIdx = findMatchingFi(lines, blockStartIdx)
    if (isFailOpen(lines.slice(blockStartIdx, fiIdx + 1))) {
      findings.push({ file, line: startLine, tool })
    }
  }
  return findings
}

function hasZeroExit(blockLines: string[]): boolean {
  return /\b(?:return|exit)\s+0\b/.test(blockLines.join('\n'))
}

function hasNoBlockingElse(blockLines: string[]): boolean {
  let depth = 1
  let elseIdx = -1
  for (let i = 1; i < blockLines.length; i++) {
    const line = blockLines[i] ?? ''
    if (/\bif\b(?!\s*!\s*command)/.test(line) && /;\s*then\s*$|then\s*$/.test(line)) depth++
    if (/^\s*else\b/.test(line) && depth === 1) elseIdx = i
    if (/(?:^|[;\s])fi(?:[;\s]|$)/.test(line)) depth--
  }
  if (elseIdx === -1) return true
  const elseLines = blockLines.slice(elseIdx)
  elseLines[0] = elseLines[0]?.replace(/^\s*else\b/, '') ?? ''
  const last = elseLines.length - 1
  elseLines[last] = elseLines[last]?.replace(/(?:^|;)\s*fi(?:[;\s]|$).*$/, '') ?? ''
  const elseBody = elseLines.join('\n').trim()
  if (elseBody === '') return true
  return elseBody
    .split(/[;\n]/)
    .every((command) => /^(?:#.*|(?:echo|printf)\b.*|:\s*(?:#.*)?)$/.test(command.trim()))
}

/** Scan one file's text for all four fail-open detector shapes. */
function scanFileText(text: string, file: string): FailOpenFinding[] {
  // Join `\`-continued lines first so the same-line forms aren't split by a backslash wrap.
  const joined = text.replace(/\\\n/g, ' ')
  const findings: FailOpenFinding[] = []
  for (const m of joined.matchAll(BRACE_FORM_RE)) {
    const tool = m[1]
    if (tool) findings.push({ file, line: lineOf(joined, m.index), tool })
  }
  for (const m of joined.matchAll(BARE_FORM_RE)) {
    const tool = m[1]
    if (tool) findings.push({ file, line: lineOf(joined, m.index), tool })
  }
  findings.push(...findGuardFindings(joined, file, IF_GUARD_RE, hasZeroExit))
  findings.push(...findGuardFindings(joined, file, POSITIVE_IF_GUARD_RE, hasNoBlockingElse))
  return findings
}

interface AllowlistEntry {
  file: string
  line: number
  reason?: string
}

interface AllowlistResult {
  entries: AllowlistEntry[]
  malformed: boolean
}

function loadAllowlist(path: string): AllowlistResult {
  if (!existsSync(path)) return { entries: [], malformed: false }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { entries?: AllowlistEntry[] }
  const entries = raw.entries ?? []
  const malformed = entries.some((e) => !e.reason || e.reason.trim() === '')
  return { entries, malformed }
}

function applyAllowlist(
  findings: FailOpenFinding[],
  allowlist: AllowlistEntry[],
): FailOpenFinding[] {
  return findings.map((f) => {
    const match = allowlist.find((e) => e.file === f.file && e.line === f.line && e.reason)
    return match?.reason ? { ...f, allowlisted: match.reason } : f
  })
}

function emitTextOutput(findings: FailOpenFinding[]): void {
  process.stdout.write('\n')
  if (findings.length === 0) {
    process.stdout.write('  no fail-open patterns found\n\n')
    return
  }
  for (const f of findings) {
    const suffix = f.allowlisted ? `  (allowlisted: ${f.allowlisted})` : ''
    process.stdout.write(`  ${f.file}:${f.line}  command -v ${f.tool}${suffix}\n`)
  }
  process.stdout.write('\n')
}

export function runDoctorFailOpenCensus(
  opts: DoctorFailOpenCensusOptions = {},
): DoctorFailOpenCensusResult {
  const dir = resolve(opts.dir ?? '.')
  const allowlistPath = opts.allowlistPath ?? join(dir, '.arbiter', 'fail-open-allowlist.json')

  const { entries, malformed } = loadAllowlist(allowlistPath)
  if (malformed) {
    if (opts.json) {
      jsonOutput(
        'doctor fail-open-census',
        'error',
        { findings: [] },
        ['Allowlist entry missing a reason — every entry must justify its suppression.'],
        { errorClass: 'config' },
      )
    } else {
      process.stderr.write(
        `  Error: allowlist entry missing a reason (${relative(dir, allowlistPath)})\n`,
      )
    }
    return { exitCode: 2, findings: [] }
  }

  const rawFindings = listScanFiles(dir)
    .flatMap((path) => scanFileText(readFileSync(path, 'utf-8'), relative(dir, path)))
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))

  const findings = applyAllowlist(rawFindings, entries)
  const unsuppressed = findings.filter((f) => !f.allowlisted).length
  const exitCode: 0 | 1 = unsuppressed > 0 ? 1 : 0

  if (opts.json) {
    jsonOutput('doctor fail-open-census', exitCode === 0 ? 'ok' : 'error', { findings })
  } else {
    emitTextOutput(findings)
  }

  return { exitCode, findings }
}
