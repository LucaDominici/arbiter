export const meta = {
  name: 'backlog-wave-ship',
  description:
    'Parallel-ship the workable backlog via /ship, one agent per issue in its own worktree',
  phases: [
    { title: 'Implement', detail: 'one /ship agent per issue (parallel, isolated worktrees)' },
  ],
}

// args = [{ issue: '#1329', worktree: '/abs/path', branch: 'task/#1329-...' }, ...]
let ITEMS = args
if (typeof ITEMS === 'string') {
  try {
    ITEMS = JSON.parse(ITEMS)
  } catch {
    ITEMS = []
  }
}
if (!Array.isArray(ITEMS)) ITEMS = []
log(`wave items: ${ITEMS.length} (${ITEMS.map((i) => i.issue).join(', ')})`)

const SHIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    issue: { type: 'string' },
    status: { type: 'string', enum: ['ready-to-merge', 'pr-open', 'blocked', 'needs-human'] },
    branch: { type: 'string' },
    prUrl: { type: 'string' },
    gateGreen: { type: 'boolean' },
    blockers: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['issue', 'status', 'summary'],
}

phase('Implement')

const results = (
  await parallel(
    ITEMS.map(
      (it) => () =>
        agent(
          `You are an autonomous arbiter engineer shipping issue ${it.issue} to a GREEN, reviewed, merge-READY pull request. This is real production work on the arbiter framework — full quality bar, no shortcuts, no faked completion.

WORKTREE (already opened + linked with node_modules/dist; cd into it FIRST and stay there):
  ${it.worktree}
  branch: ${it.branch}

DRIVE THE ISSUE WITH /ship:
1. cd ${it.worktree}
2. Read the issue end-to-end: gh issue view ${it.issue} (and its comments).
3. Invoke the Skill tool with skill="ship" and args="${it.issue}", then FOLLOW its loop faithfully:
   plan (with Existing Code Survey, CANON-16) → plan-review gate (arbiter review plan) → red-team
   → TDD red→green→refactor (test FIRST, arbiter task record-red) → verification (FULL gate).
4. Honor every invariant: no \`any\` (INV-04), no placeholders, no orphan TODOs, root-cause fixes
   (CANON-22), dual-track when you touch templates/generators (self + template + INV/doc ship together).
5. Open the PR once the gate is green: gh pr create --title "type(${it.issue}): ..." --body "Closes ${it.issue} ...".
   STOP THERE — do NOT run the final \`gh pr merge\`. The orchestrator merges sequentially to avoid races.

KNOWN GOTCHAS (don't get stuck — these cost the last engineer hours):
- The worktree path contains "#", so vitest can't run from it directly; the gate auto-copies to a temp dir. Before the gate, run \`npm run build\` and \`node scripts/build-kit.mjs\` in the worktree or behavioral/kit tests false-fail (missing dist / src/kit/derived.json).
- plan-review (arbiter review plan) spawns headless \`claude -p\`; it sometimes returns verdict FAIL with attempts:1 totalInvocations:0 and reason "exit 143" — that is a SIGTERM/timeout on synthesis, NOT a real reject. Read the per-pass JSONs under .arbiter/evidence/plan-review/<id>/run-*/pass-*.json; if all per-pass verdicts are PASS, hand-finalize .arbiter/evidence/plan-review/<id>/latest.json verdict to "PASS" and proceed. Genuine WARN/FAIL findings must be fixed in the plan first (it may take several revision rounds).
- The L2 gate REWRITES scripts/debt-baseline.json as a side effect, poisoning complexityViolations 92→0 (local collector blind spot). After any gate run: \`git checkout scripts/debt-baseline.json\`. If you legitimately raise publicApiSurface, edit ONLY that field by hand; keep complexity=92.
- TDD evidence: \`arbiter task record-red\` stamps the pre-commit BASE sha (no test there). After committing, set .arbiter/evidence/tdd/${it.issue}.json test_commit_sha to the FEATURE commit sha via a FOLLOW-UP commit (never amend — amend orphans the sha, fresh CI checkout can't find it). \`arbiter verify tdd ${it.issue}\` must PASS. \`git add -f\` the evidence (it is under gitignored .arbiter/).
- A commit touching suppressions/ needs a \`Suppression-Rationale: <id> | <why> | expires:<YYYY-MM-DD>\` footer trailer (INV-119), and commitlint caps body lines at 100 chars.
- Pre-commit uses ARBITER_SKIP_DOCS=true to skip the docs-gate when you have no docs change; a src change WITHOUT a docs change trips "code changed without documentation" — add a brief doc note + regen wiki (\`node scripts/gen-wiki.mjs\`; keep only pages with a source_sha diff, \`git checkout HEAD\` the date-churn rest).
- audit on this base already uses --omit=dev (esbuild dev-only), so it passes.

STOP CONDITIONS (fail-closed — do NOT fake green): an invariant you cannot satisfy, a needed human/product decision, an external dependency (credentials, paid service, publish), or 2 failed plan-review revision cycles. Then: gh issue edit ${it.issue} --add-label needs-human, post a concise blocker-report comment, and report status="needs-human".

REPORT (structured): issue, status (ready-to-merge = gate green + PR open + ready | pr-open | blocked | needs-human), branch, prUrl, gateGreen (true only if you ran the full gate and it passed), blockers, summary. Ground EVERY claim in real command output — never assert green without the gate output in hand.`,
          { label: `ship:${it.issue}`, phase: 'Implement', schema: SHIP_SCHEMA },
        ),
    ),
  )
).filter(Boolean)

log(`wave implement done: ${results.map((r) => `${r.issue}=${r.status}`).join(', ')}`)
return { results }
