# /complete-task

Finalize a task: gate, commit, PR, merge.

## Steps

1. Run `node scripts/check-all.mjs L2` — must be GREEN
2. Commit with convention: `type(#NNN): summary`
3. Push branch: `git push -u origin HEAD`
4. Create PR: `gh pr create --title "type(#NNN): summary" --body "..."`
5. Verify CI passes: `gh pr checks`
6. Merge when green: `gh pr merge --squash`
7. Close issue: `gh issue close NNN`

## Gate Failure

If gate fails: fix root cause. No `--no-verify`. No skipping.
Report blocker if fails after two focused attempts.
