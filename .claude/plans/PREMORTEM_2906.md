# Premortem — #2906 (required, R3-standard-multi-area, areas=7)

The executable brief is the premortem for this task:
/home/luca/work/repos/arbiter-assessment/reconciliation/current/step1-b2/PREMORTEM_2906.md
The design comes from a pre-registered replay: step1-replay/RUBRIC.md and RESULT.md (rule [S]).

Failure modes, from the replay's Surprises:
- Correct fix + weakened test: the original passes at head, so the change is accepted structurally. Control: AC-4 still surfaces the hunk to the reviewer.
- A weakening that keeps the assertion count: caught only by the reviewer. Control: AC-4.
- Nondeterministic original test (clock, repo state): AC-3 refuses mixed runs.
- A crashed or zero-work original run counted as a pass: AC-3.
- A trailer from an earlier amendment reused after a further edit: AC-2 binds the head blob.
- A trailer line longer than the 100-char commitlint footer limit: AC-2 format.
- The replay itself running inside the writer's checkout and leaving a modified test behind: it runs in an isolated detached worktree.
