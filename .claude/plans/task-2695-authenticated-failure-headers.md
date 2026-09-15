# Plan — #2695 Authenticate JavaScript failure headers

## Preamble

- Baseline: `71052fc08f8cd5904478e1e520cfd5f3584fd79a` (`origin/main` at preflight).
- Readiness: PASS after naming the existing boundary as `Non-goals` and listing the two touched contracts; acceptance criteria are unchanged.
- Product RTM: no `FEATURE_MATRIX.md` exists in this repository, so this internal evidence-integrity fix has no product-row update.
- Delivery mode: one root implementer, one independent final reviewer, one adversarial AC-fit verdict; no implementation subagents or specialist reviewers.
- Companion: ponytail full; existing V1 evidence and parser are reused.

## Approach & decomposition

Deliver one capability: a JavaScript RED replay proves the same reporter/project failures, rather than only the same count of normalized file/test strings.

1. Add focused counterexamples to the existing replay test: two recorded project identities cannot be satisfied by two copies of one project; arbitrary background styling and code-frame indentation remain untrusted; legitimate pipe and captured ANSI badge forms compare as the same project identity.
2. Change the existing `extractFailureIdentities` path only. Preserve the normalized project badge in the identity, normalize the exact Vitest coloured badge framing into the existing pipe form, and accept only zero or one leading ASCII space before a JavaScript failure header.
3. Re-run the focused suite, existing TDD evidence verifier tests, then the native final gate once after review on a frozen HEAD.

There is no template twin or generated copy of `src/evidence/tdd.ts`; no propagation beyond its existing callers is required.

## Threat model & abuse cases

Repository code executed during `record-red` can print crafted output. A duplicate same-project line, a coloured diagnostic prefix, or an indented source/code-frame line must not impersonate independent failures. V1 logs cannot provide cryptographic reporter provenance, so this slice authenticates only the exact supported reporter grammar and exact project identity already present in retained logs; arbitrary output that exactly reproduces that grammar remains an accepted V1 limitation.

## Input validation

The trust boundary is `extractFailureIdentities(log)`. It accepts JavaScript headers only when they start at column zero or with Vitest's single padding space, contain an optional pipe-delimited project badge, and end the header prefix in a `.test`/`.spec` JavaScript path. ANSI project badges normalize only when their SGR order matches Vitest's black-foreground/background badge and paired resets on the same line. Any missing identity makes replay comparison fail closed in `compareFailure`.

## Idiomatic patterns & pitfalls

- Reuse the existing regex normalization and sorted array comparison; do not add a parser class, schema field, store, dependency, retry, or migration.
- Keep project text intact apart from reporter padding so local `|project|` and coloured CI output compare equally.
- Do not use `\s` for line padding because it includes newlines; do not accept unlimited indentation because quoted/code-frame text is not a reporter header.
- Do not deduplicate JavaScript identities: occurrence count remains evidence.

## Acceptance Criteria

- [ ] AC-1: Replay distinguishes the required project/reporter failure instances, or provides an equivalent authenticated identity, while remaining stable across legitimate local/CI badge rendering differences.
- [ ] AC-2: A duplicated same-project failure cannot satisfy two recorded project failures.
- [ ] AC-3: Arbitrary background-styled diagnostic prefixes and indented code-frame `FAIL` text cannot satisfy a JavaScript failure header.
- [ ] AC-4: Existing single-project, reordered complete failure, ANSI CI badge, quoted code-frame, timeout, missing-tool, truncated-output and mismatch behavior remains covered and fail closed.

## Non-Goals

- Do not add an evidence store, parser framework, schema migration, retry path or orchestration mechanism.
- Do not change non-JavaScript failure parsing.
- Do not broaden the accepted JavaScript reporter syntax beyond captured legitimate V1 forms.

## Merge contract

1. Acceptance: AC-1 through AC-4 above, frozen verbatim from issue #2695.
2. Policy: INV-25, INV-38, INV-114, INV-131, INV-138 and CANON-25. The change that turns the verifier red is a replay with a wrong project identity or non-reporter header syntax; the focused counterexamples prove both inversions.
3. Required tests: `__tests__/evidence/tdd-reexecute.test.ts` maps every AC to an observable replay verdict and retains the existing fail-closed matrix.
4. CI: focused Vitest during RED/GREEN; final clean-HEAD L3 once after review; PR required checks and exact-SHA main checks green.
5. Review: one independent reviewer on frozen source SHA plus one adversarial AC-fit verdict. Reconcile all findings in one fix batch; a source change invalidates both and creates one new frozen SHA.
6. Dependencies: `extractFailureIdentities` is consumed only by `src/evidence/tdd-reexecute.ts`; scalar recording/validation callers continue through `extractFailureSignature` unchanged. Existing V1 evidence remains readable.

Landing route supported: yes — normal PR merge after exact-HEAD evidence and CI.

## Test strategy

| AC | Proof |
| --- | --- |
| AC-1 | Pipe-labelled recording and exact captured ANSI Vitest replay yield the same identities, including project names. |
| AC-2 | Recording `unit` plus `integration` rejects replaying `unit` twice. |
| AC-3 | A background-only arbitrary badge and a two-space/tab-indented `FAIL` line yield no acceptable replay identity. |
| AC-4 | The existing replay suite remains green, covering single-project, reordering, ANSI, quoted frames, timeout, missing tool, truncation and mismatch. |

The RED commit contains only new/changed tests and records the failure against the frozen criteria. GREEN changes only `src/evidence/tdd.ts`. One execution unit covers the single acceptance boundary.

## Risks

- A legitimate runner may format a project badge differently from the captured Vitest V1 forms. Mitigation: retain both uncoloured pipe form and the exact coloured Vitest form; unknown forms fail closed and require a captured-log extension.
- Keeping the project badge changes equality for old multi-project evidence that replayed after project renaming. This is intended: a renamed reporter/project is a different failure origin and must be re-recorded.
- V1 remains log-derived and spoofable by code that emits the exact reporter grammar. Accepted residual: eliminating that class requires structured runner output and belongs in a separately evidenced contract, not this bounded repair.
