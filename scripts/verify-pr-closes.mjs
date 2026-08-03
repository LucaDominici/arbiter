#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/verify-pr-closes.mjs
// #1766: GitHub's closing-keyword parser only reliably auto-closes the FIRST issue in a
// comma-separated `Closes #N1, #N2, ...` PR body list on admin/rebase-merge — every issue
// after the first is silently left open. This script is the defense-in-depth repair: given
// a merged PR number, parse every closing-keyword reference out of its body, check which
// referenced issues are still open, and close the stragglers (or just report them in
// --dry-run mode).
//
// Root-cause fix lives in `.claude/skills/wave-drain/SKILL.md` (+ its .ejs template): PR
// bodies must emit one `Closes #N` per line, never a comma-list. This script is the
// safety net for PRs that predate that fix, or any body a human hand-writes non-canonically.
//
// Usage:
//   node scripts/verify-pr-closes.mjs <PR#>              # closes any open stragglers
//   node scripts/verify-pr-closes.mjs <PR#> --dry-run     # report only, closes nothing
//
// Exported functions (for unit tests):
//   parseCloseRefs(body)                    → number[] (deduped, in first-seen order)
//   runCli(prNumber, io, dryRun)             → Promise<0|1|2>  (INV-53: 0=all closed/no refs,
//                                              1=stragglers found in --dry-run, 2=error)

import { spawnSync } from 'node:child_process'
import { isMainModule } from './lib/run-helpers.mjs'

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

const CLOSING_KEYWORDS = [
  'close',
  'closes',
  'closed',
  'fix',
  'fixes',
  'fixed',
  'resolve',
  'resolves',
  'resolved',
]

/**
 * Parse every GitHub closing-keyword issue reference out of a PR body — covers both the
 * canonical one-per-line form (`Closes #N1\nCloses #N2`) and the buggy comma/and-joined
 * form (`Closes #N1, #N2, ...` or `Closes #N1 and #N2`) so this script can repair PRs
 * written before the SKILL.md root-cause fix. Case-insensitive keyword match. Returns
 * issue numbers deduped, in first-seen order. Bare `#N` mentions with no closing keyword
 * are NOT included (they are not closing references).
 */
export function parseCloseRefs(body) {
  if (!body) return []
  const seen = new Set()
  const out = []
  const keywordAlt = CLOSING_KEYWORDS.join('|')
  // Match "<keyword> #N1, #N2, ... and #N3" style lists: keyword, then a run of
  // "#N" tokens separated by comma/"and"/whitespace.
  const re = new RegExp(`\\b(?:${keywordAlt})\\b((?:\\s*(?:,|and)?\\s*#\\d+)+)`, 'gi')
  let m
  while ((m = re.exec(body))) {
    const numRe = /#(\d+)/g
    let nm
    while ((nm = numRe.exec(m[1]))) {
      const n = Number(nm[1])
      if (!seen.has(n)) {
        seen.add(n)
        out.push(n)
      }
    }
  }
  return out
}

/** Default IO: shells out to `gh`. Injectable for tests. */
function realIo() {
  return {
    getPrBody(prNumber) {
      const r = spawnSync('gh', ['pr', 'view', String(prNumber), '--json', 'body'], {
        encoding: 'utf-8',
      })
      if (r.status !== 0) return { error: (r.stderr || 'gh pr view failed').trim() }
      try {
        return { body: JSON.parse(r.stdout).body ?? '' }
        // FAIL-OPEN-INTENT: error is returned (not thrown) — runCli() surfaces it and exits 2.
      } catch (err) {
        return {
          error: `could not parse gh pr view output: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
    getIssueState(issueNumber) {
      const r = spawnSync('gh', ['issue', 'view', String(issueNumber), '--json', 'state'], {
        encoding: 'utf-8',
      })
      if (r.status !== 0) return { error: (r.stderr || 'gh issue view failed').trim() }
      try {
        return { state: JSON.parse(r.stdout).state }
        // FAIL-OPEN-INTENT: error is returned (not thrown) — runCli() surfaces it and exits 2.
      } catch (err) {
        return {
          error: `could not parse gh issue view output: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
    closeIssue(issueNumber, comment) {
      const r = spawnSync('gh', ['issue', 'close', String(issueNumber), '--comment', comment], {
        encoding: 'utf-8',
      })
      if (r.status !== 0) return { error: (r.stderr || 'gh issue close failed').trim() }
      return { ok: true }
    },
  }
}

/**
 * Verify every closing-keyword reference in PR #prNumber's body is closed; close any
 * stragglers unless dryRun. Returns 0/1/2 (INV-53: 0=OK, 1=stragglers reported in
 * dry-run, 2=error). Does not call process.exit — exported for testing.
 * Fail-closed (INV-96): a gh error returns 2 rather than silently reporting success.
 */
export async function runCli(prNumber, io, dryRun) {
  try {
    const { body, error: bodyErr } = io.getPrBody(prNumber)
    if (bodyErr) {
      process.stderr.write(`verify-pr-closes: ${bodyErr}\n`)
      return 2
    }

    const refs = parseCloseRefs(body)
    if (refs.length === 0) {
      process.stdout.write(
        `verify-pr-closes: no closing-keyword references found in PR #${prNumber}.\n`,
      )
      return 0
    }

    const stragglers = []
    for (const issue of refs) {
      const { state, error: stateErr } = io.getIssueState(issue)
      if (stateErr) {
        process.stderr.write(`verify-pr-closes: ${stateErr}\n`)
        return 2
      }
      if (state === 'OPEN') stragglers.push(issue)
    }

    if (stragglers.length === 0) {
      process.stdout.write(
        `verify-pr-closes: all ${refs.length} referenced issue(s) are closed for PR #${prNumber}.\n`,
      )
      return 0
    }

    if (dryRun) {
      process.stdout.write(
        `verify-pr-closes: PR #${prNumber} left ${stragglers.length} issue(s) open: ${stragglers.map((n) => `#${n}`).join(', ')}\n`,
      )
      return 1
    }

    for (const issue of stragglers) {
      const { error: closeErr } = io.closeIssue(
        issue,
        `Closed by verify-pr-closes.mjs — referenced by \`Closes\`/\`Fixes\`/\`Resolves\` in PR #${prNumber} but left open due to the GitHub comma-list closing-keyword limitation (#1766).`,
      )
      if (closeErr) {
        process.stderr.write(`verify-pr-closes: ${closeErr}\n`)
        return 2
      }
    }
    process.stdout.write(
      `verify-pr-closes: closed ${stragglers.length} straggler(s) for PR #${prNumber}: ${stragglers.map((n) => `#${n}`).join(', ')}\n`,
    )
    return 0
  } catch (err) {
    process.stderr.write(`verify-pr-closes: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — guarded so imports don't trigger side-effects
// ---------------------------------------------------------------------------

const isMain = isMainModule(import.meta.url)

if (isMain) {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const prArg = argv.find((a) => !a.startsWith('--'))
  if (!prArg || !/^\d+$/.test(prArg)) {
    process.stderr.write('Usage: node scripts/verify-pr-closes.mjs <PR#> [--dry-run]\n')
    process.exit(2)
  }
  runCli(Number(prArg), realIo(), dryRun)
    .then((code) => process.exit(code))
    .catch((err) => {
      // Safety net for unexpected promise rejections (INV-96 fail-closed).
      process.stderr.write(
        `verify-pr-closes: ${err instanceof Error ? err.message : String(err)}\n`,
      )
      process.exit(2)
    })
}
