## Summary

<!-- What does this PR do? Why? (1-3 bullets) -->

## Changes

<!-- Bullet list of what changed -->

## Gate Checklist

- [ ] Exact-head CI full gate (`node scripts/check-all.mjs L2`) passes
- [ ] No orphan TODOs (all TODO have task IDs)
- [ ] No invariant violations (see AGENTS.md)
- [ ] Tests added/updated for changed code
- [ ] Commit messages follow convention: `type(scope): summary`

## Pipeline Artifacts

<!-- Optional: link relevant artifacts from CI pipeline -->

| Artifact     | Link |
| ------------ | ---- |
| Spec / Plan  |      |
| Review score |      |
| Log          |      |

## Test Plan

<!-- How was this tested? What scenarios were covered? -->

## Security Checklist

<!-- L2/L3 projects: verify SECURE_CODING_CHECKLIST.md before merging -->

- [ ] Reviewed `docs/SECURE_CODING_CHECKLIST.md` (if present in this project)
- [ ] No deprecated endpoints added without `Sunset` header (RFC 8594) — N/A if no public API changes
