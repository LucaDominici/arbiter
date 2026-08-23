#!/usr/bin/env node
// Fail if a Java file uses raw generic types (unparameterized generics)
// FAIL-OPEN-INTENT: hook exits 0 for non-Java files; Java violations exit 2 (blocking, #2326)
import { readFileSync, existsSync } from 'node:fs'
import { resolveToolInputPath } from './lib.mjs'
const file = resolveToolInputPath()
if (!file.endsWith('.java')) process.exit(0)
if (!existsSync(file)) process.exit(0)
const repoRoot = process.cwd()
if (!file.startsWith(repoRoot)) process.exit(0)
const lines = readFileSync(file, 'utf-8').split('\n')
const offending = lines.flatMap((line, i) => {
  const t = line.trimStart()
  // Skip comments AND import/package statements — fully-qualified type names in
  // imports legitimately appear unparameterized (e.g. `import java.util.List;`).
  // Previously every non-trivial Java file tripped the hook on its own imports
  // (#278 finding #6).
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return []
  if (t.startsWith('import ') || t.startsWith('package ')) return []
  return /\b(List|Map|Set|Collection|ArrayList|HashMap|HashSet|LinkedList|Queue|Deque|Iterator|Optional)\b(?!<)/.test(
    line,
  )
    ? [`${i + 1}: ${line.trim()}`]
    : []
})
if (offending.length > 0) {
  process.stderr.write(
    `[arbiter] INV: Raw generic type found (always use type parameters like List<String>): ${file}\n`,
  )
  offending.slice(0, 3).forEach((l) => process.stderr.write(`  ${l}\n`))
  // Exit 2 is the ONLY blocking code under the Claude Code hook protocol: it feeds the
  // violation back to the agent. Exit 1 is non-blocking — it prints and the agent never
  // sees it, so the guard was decoration. Same regression as #1631 (enforce-read-only);
  // caught here by the self-surface hardness probe (#2326).
  process.exit(2)
}
