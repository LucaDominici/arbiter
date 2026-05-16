---
'@arbiter/cli': minor
---

feat(#730): generate check-no-skipped-tests.mjs hook for target projects. The new NI-11 enforcement hook blocks `.skip()`, `xit()`, `@Disabled`, `@pytest.mark.skip`, and `#[ignore]` patterns on PostToolUse Edit|Write. Wired in the Claude hooks dispatcher and Codex config adapter for all target projects.
