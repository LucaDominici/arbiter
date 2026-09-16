# Plan — #2703 Harden orphan TODO lexical state

## Baseline and capability

- Baseline: `e7d3b9de02ebd93db02499ef9da1ab518877174c` (`origin/main`).
- Deliverable: `findOrphanTodos` advances lexical state correctly for the three remaining language edge cases without becoming a general parser.
- Public test seam: `findOrphanTodos(content, extension)`, explicitly named by issue #2703.
- One implementer; independent review only after the plan and after frozen HEAD.

## Scope

1. Add one behavior regression at a time for JavaScript regex literals containing a backtick, JavaScript backslash-newline string continuation, and Go raw backtick strings whose final content character is a backslash.
2. Make the existing scanner language-aware only where those cases require it. Reuse the current state machine; add no parser dependency or new module.
3. Keep the runtime script and generator template identical in behavior. Regenerate the three checked-in examples and bake snapshots through the existing commands.
4. Preserve the behavior already proved for Python hash comments, Python/Java/Kotlin triple strings, JS template strings, block comments, and zero-file fail-closed scans.

## Acceptance criteria

- [ ] AC-1: a JavaScript regex literal containing a backtick does not enter template-string state; a later orphan comment is found.
- [ ] AC-2: a JavaScript single/double-quoted string continued by backslash-newline remains quoted on the next line; comment-shaped continuation text is ignored and a later real orphan is found.
- [ ] AC-3: in `.go`, backslashes inside raw backtick strings are literal; a closing backtick after a trailing backslash closes the raw string and a later orphan is found.
- [ ] AC-4: all pre-existing focused regressions remain green.
- [ ] AC-5: runtime, template, generated examples, manifests, and bake snapshots remain coherent using canonical regeneration.
- [ ] AC-6: no new dependency, parser, framework, configuration axis, or evidence store.

## Non-goals

- No editor-hook rewrite: the issue acceptance boundary is the tree gate's exported `findOrphanTodos` function.
- No second-block-opener work: #2550's complexity refactor already eliminated that reported case.
- No attempt to parse every JavaScript regular-expression ambiguity; only the minimum lexical discrimination needed to prevent quote characters inside regex bodies from corrupting cross-line state.

## TDD and verification

Use vertical red-green slices at the exported seam. For each criterion: add the smallest failing regression, prove RED, implement the minimum state transition, and rerun the focused test file. After the three slices, run the language-aware template integration test, regenerate examples, update bake snapshots through the existing bake test, and run focused coherence checks. Freeze HEAD before independent domain and test-quality review. Rework findings once per round, then run one clean full L2 gate, PR CI, merge, and verify the issue/main state.

## Risk control

The only material risk is mistaking division for a regex literal. The implementation must use the narrowest existing-context heuristic that fixes the proved case and retain tests for division, templates, comments, and multiline state. If the local scanner cannot satisfy the three concrete regressions without broad ambiguity, stop rather than introduce a home-grown parser.

## Propagation and rollback

Source changes are limited to the scanner, its EJS twin, and focused tests. Checked-in examples, manifests, and bake snapshots are generated consequences. Rollback is one atomic revert of the canary PR.
