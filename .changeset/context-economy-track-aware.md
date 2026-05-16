---
'@arbiter/cli': minor
---

Generate context-economy rule, machine-readable knowledge-map, pre-task track detection hook, and track-aware post-commit checklist (#720, #724).

- `.claude/rules/40-context-economy.md` — minimum startup set + track routing table
- `.claude/knowledge-map.json` — machine-readable track routing (signal paths, required/optional docs per track)
- `.claude/hooks/pre-task-track-detect.mjs` — UserPromptSubmit hook that detects frontend/backend/docs track from changed files and prompt keywords
- `post-commit-check.mjs` extended with per-track checklist output after INV-22 conventional commit check
