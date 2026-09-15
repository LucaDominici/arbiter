# Plan — #2550 Make TODO debt measure real orphan work

## Preamble

- Baseline: `0027d33f05c4648e380f8a5db3a020a269e86fa5` (`origin/main` at preflight).
- Current defect: `countTodos` counts any line containing the word `TODO`, including tracked `TODO(#NNN)`, strings, prose and fixtures, while excluding `.mjs`; the release gate uses a different matcher.
- Product RTM: no `FEATURE_MATRIX.md` row references #2550, so this internal truth-metric fix has no product-row update.
- Delivery: one root implementer, one independent frozen-SHA reviewer, no implementation or AC-fit subagents.

## Deliverable and scope

Deliver one capability: `todoCount` is the count of real orphan TODO comments under the repository walk, using the same detector as INV-21.

1. Export the existing `findOrphanTodos(content)` detector from `check-no-orphan-todo.mjs` and make it identify the first real line/block comment outside quoted strings. A nested example inside prose is not a second comment; an inline source comment remains visible.
2. Reuse that detector plus the gate's exported `EXTENSIONS` in `debt-lib.mjs`. This adds `.mjs` and removes the private bare-word matcher. An unreadable candidate file throws instead of being silently omitted.
3. Apply the same source/template changes to the emitted checker and debt library. No new dependency, registry, parser package or metric is introduced.
4. Tighten `scripts/debt-baseline.json` through the canonical `capture-debt-baseline.mjs --update` path after the detector is proven.

Propagation is limited to the two runtime scripts, their two generator templates, one focused existing test file, and the canonical baseline if the updater tightens it.

## Current-truth correction

Issue AC-4 says the release gate honors `arbiter-suppress`. Current main does not: only the edit hook calls `findInlineSuppression`; `scripts/check-no-orphan-todo.mjs` reports every orphan it scans. This slice will not invent a metric-only suppression escape, because that would let debt report green while the release gate fails. Metric and release gate stay aligned. Suppression support, if later desired, must be added once to the shared detector and consumed by both.

## Acceptance criteria

- AC-1: `countTodos` and INV-21 call the same exported orphan-comment detector; no second TODO regex remains in `debt-lib`.
- AC-2: `TODO(#123)` does not count, so binding an orphan to an issue improves the metric.
- AC-3: `.mjs` participates through the gate's shared extension set; the repository walk still covers enforcement code.
- AC-4: a metric-only suppression exception is rejected because current release-gate behavior does not support it; this factual correction is recorded on #2550.
- AC-5: one inversion proves a real orphan comment counts, while a tracked form, string literal and explanatory prose do not. A regression to a detector that counts nothing fails.
- AC-6: the emitted template has the same behavior and the debt baseline is tightened only by the canonical updater.

## Test strategy

Add one table-driven test to the existing debt-lib test file using a temporary repository-shaped tree. It plants a real orphan in `.mjs`, tracked and non-comment controls in `.ts`, plus an explanatory nested example; expected count is exactly one. The RED commit changes only this test. GREEN exports/reuses the detector and updates template twins. Then run the focused checker/debt tests, generator/template parity, L1, frozen-SHA review, AC-fit and one final clean-HEAD L3.

## Risks and limits

- The comment scanner is deliberately line-oriented. It handles single/double/backtick strings, escapes, `//`, `/*` and leading `*`; it does not become a language parser. The existing gate is already line-oriented.
- Counting the full repository is retained so enforcement `.mjs` files are visible. Vendor/build/template paths remain excluded by the existing repository walk and gate skip sets.
- Changing the definition can move `todoCount` sharply. That is the intended truth correction; unrelated baseline keys may tighten only if the canonical one-way updater measures genuine improvements.

## Merge contract

- One deliverable, one fix batch per review round, one final reviewer.
- Required proof: focused inversion, generated template parity, live debt report, L1, final L3, PR CI.
- Done means exact-SHA merge, CI green, #2550 closed and the main ref verified.
