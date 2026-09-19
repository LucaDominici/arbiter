# Execution Protocol

Before editing, confirm the task branch and read the active plan. Use the `/ship`
entrypoint for delivery. Keep checkpoint evidence intact and record red-test
evidence before advancing a TDD phase.

If a gate fails, stop after two focused attempts and report the actual blocker;
never bypass it or suppress an orphan TODO. Checkpoint commits may capture staged
work cheaply; reserve the full gate for the final candidate.

## Root-Cause Discipline (CANON-22)

When you touch code that the duplication, complexity, or dead-code gates flag, fix
the root cause (extract the shared helper, simplify, delete the dead branch) or run
`arbiter lifecycle record-debt` with a rationale first. A symptom-only patch over a
known smell is a stop condition; the duplication ratchet blocks any net increase.
