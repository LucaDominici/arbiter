#!/usr/bin/env node
// Claude hook: blocks unused TypeScript value-level exports in files being written/edited.
// Fires on: PostToolUse → Edit|Write (TypeScript projects only)
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? ''
if (!file || !existsSync(file)) process.exit(0)
const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts']
if (!TS_EXTS.some((ext) => file.endsWith(ext))) process.exit(0)

let raw = ''
try {
  raw = execSync('npx knip --include exports,types --reporter json --no-progress', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  })
} catch (e) {
  const err = e && typeof e === 'object' ? e : {}
  if ('code' in err && err.code === 'ENOENT') {
    process.stderr.write(
      '[check-no-unused-exports] knip not found — skipping. Run: npm install knip\n',
    )
    process.exit(0)
  }
  raw = 'stdout' in err && err.stdout != null ? String(err.stdout) : ''
}

if (!raw.trim()) process.exit(0)

let report
try {
  report = JSON.parse(raw)
} catch {
  process.exit(0)
}

if (!Array.isArray(report?.issues)) process.exit(0)

const fileIssues = report.issues.filter(
  (f) => resolve(f.file) === file && (f.exports?.length ?? 0) + (f.types?.length ?? 0) > 0,
)
if (fileIssues.length === 0) process.exit(0)

process.stderr.write('Unused exports detected (knip):\n')
for (const f of fileIssues) {
  for (const exp of [...(f.exports ?? []), ...(f.types ?? [])]) {
    process.stderr.write(`  ${f.file}:${exp.line ?? '?'} — ${exp.name}\n`)
  }
}
process.stderr.write('\nRemove unused exports before saving.\n')
process.exit(1)
