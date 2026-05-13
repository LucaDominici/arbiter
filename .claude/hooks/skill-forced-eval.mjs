#!/usr/bin/env node
// Arbiter hook: phase-aware skill activation nudge
// Hook type: UserPromptSubmit — fires before every user prompt
// stdout is injected as context the model sees before responding
// Smart filter: in implementation phase, only fires for code-related prompts
// Always exits 0 (non-blocking)
import { readTaskState, getRepoRoot } from './lib.mjs'
import { readFileSync } from 'node:fs'

const root = getRepoRoot()
const { phase } = readTaskState(root)

switch (phase) {
  case 'plan':
    process.stdout.write(`━━━ PLAN MODE — no file edits or code until human says GO ━━━\n`)
    break

  case 'verification':
    process.stdout.write(
      `━━━ VERIFICATION MODE ━━━\n` +
        `Run /verification-before-completion, then npm run test before committing.\n`,
    )
    break

  case 'implementation': {
    // Smart filter: only fire checklist for code-related prompts.
    // Reads prompt from UserPromptSubmit JSON stdin.
    // Falls through (fires) if prompt cannot be read — safe default.
    let promptText = ''
    try {
      const raw = readFileSync(0, 'utf-8')
      promptText = JSON.parse(raw)?.prompt ?? ''
    } catch {
      // stdin unavailable or not JSON — fire unconditionally
    }

    const CODE_KEYWORDS =
      /def|class|function|import|test|fix|refactor|implement|code|bug|error|method|interface|service|controller|adapter|repository|feature|endpoint|route|schema|migration|hook|type|record|enum/i
    if (promptText && !CODE_KEYWORDS.test(promptText)) process.exit(0)

    process.stdout.write(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `MANDATORY SKILL CHECK (evaluate before responding):\n` +
        `\n` +
        `1. About to write implementation code?\n` +
        `   → invoke /test-driven-development FIRST\n` +
        `\n` +
        `2. Human just said GO on a plan?\n` +
        `   → run a plan review subagent FIRST\n` +
        `   → use Task tool (subagent_type="general-purpose")\n` +
        `\n` +
        `3. User mentions a library, upgrade, migration, or deprecated API?\n` +
        `   → delegate to context7-docs subagent FIRST\n` +
        `\n` +
        `4. None of the above? Proceed normally.\n` +
        `   Gate command: npm run test\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
    )
    break
  }

  default:
    // idle, complete, or unknown phase — no output (zero token cost)
    break
}
