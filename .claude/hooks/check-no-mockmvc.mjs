#!/usr/bin/env node
// Fail if a Java file imports or uses MockMvc (use RestAssured instead)
// FAIL-OPEN-INTENT: hook exits 0 for non-Java files; Java violations exit 2 (blocking, #2326)
import { readFileSync, existsSync } from 'node:fs'
import { resolveToolInputPath } from './lib.mjs'
const file = resolveToolInputPath()
if (!file.endsWith('.java')) process.exit(0)
if (!existsSync(file)) process.exit(0)
const repoRoot = process.cwd()
if (!file.startsWith(repoRoot)) process.exit(0)
const content = readFileSync(file, 'utf-8')
if (
  /\b(MockMvc|AutoConfigureMockMvc|MockMvcBuilders|MockMvcRequestBuilders|MockMvcResultMatchers)\b/.test(
    content,
  )
) {
  process.stderr.write(
    `[arbiter] INV-29: MockMvc is forbidden — use RestAssured for integration tests: ${file}\n`,
  )
  // Exit 2 is the ONLY blocking code under the Claude Code hook protocol: it feeds the
  // violation back to the agent. Exit 1 is non-blocking — it prints and the agent never
  // sees it, so the guard was decoration. Same regression as #1631 (enforce-read-only);
  // caught here by the self-surface hardness probe (#2326).
  process.exit(2)
}
