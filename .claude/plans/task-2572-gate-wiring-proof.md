# Plan — #2572 Bind flip proofs to the wired gate

## Preamble

- Baseline: `86c278285531a8bd514ce009473918ea2b1b995c` (`origin/main` at preflight).
- Readiness: PASS; current-main counterexamples reproduce AC-1 through AC-3.
- Product RTM: no `FEATURE_MATRIX.md` exists in this repository, so this internal gate-integrity fix has no product-row update.
- Delivery mode: one root implementer and one independent final reviewer; no implementation subagents or specialist panel.
- Companion: ponytail full; extend the existing CANON-25 roster and flip harness only.

## Approach & decomposition

Deliver one capability: a flip proof may certify an absence gate only when the real wired invocation is itself viable and any same-script proof reuse has identical arguments.

1. Preserve each wired gate's quoted literal arguments plus a whitespace-trimmed raw argv source signature in `enumerateGateMechanisms`, and carry both into the existing absence-family entry. The raw signature keeps dynamic expressions visible to same-script reuse without adding a JavaScript parser.
2. Before synthetic flip execution, reject missing static scan roots and allowlist/config inputs from the real wiring. Reuse the current family roster; add no registry, snapshot, or runtime.
3. Limit same-script proof reuse to identical literal argv. Direct name matches remain authoritative because bespoke fixture paths intentionally differ from production paths.
4. Make the existing `i18n raw strings` fixture exercise `--inventory`: the bad fixture is not allowlisted and the clean fixture is allowlisted.
5. Document the stronger post-#2560 contract and run the focused harness, current L1, one frozen-HEAD review, then one final full gate.

Propagation is limited to `scripts/lib/gate-roster.mjs`, `scripts/check-guard-flip.mjs`, `scripts/lib/guard-flip-registry.mjs`, their existing focused test, and CANON-25 documentation. No generated twin exists for these self-only harness modules.

## Threat model & abuse cases

A maintainer or agent can accidentally rename a wired scan root, omit a critical allowlist flag from a proof, or add a stricter second invocation of an already-proven script. Today all three can remain green. The fix fails closed on a missing real static input and refuses proof reuse across different literal argv. Dynamic runtime outputs are outside the static-input check because they may not exist when the harness runs.

## Input validation

The trust boundary is each absence-family `runCheck` array in `scripts/check-all.mjs`. The parser records (a) every complete single-quoted literal after the `scripts/*.mjs` element, preserving comma-bearing literals as one value, and (b) the trimmed raw source after that script element as `argvSource`. `flipProofFor` compares ordered `argvSource`; missing values normalize to the empty string, so the current no-argument `no-empty-suite` reuse remains valid while any flag, dynamic expression, value, or order change refuses reuse.

Static filesystem inputs follow this exact grammar:

- before the first `--` flag, every positional literal is a repository-relative scan root except the exact existing selector `all`;
- `--inventory <literal>`, `--inventory=<literal>`, `--config <literal>`, and `--config=<literal>` are repository-relative static files;
- a recognized static-path flag without a non-empty literal value is an error;
- literals after any other flag are scalar values and are not paths;
- dynamic expressions and runtime-produced inputs such as `--coverage-summary` are not statically resolved, but remain in `argvSource` for proof-reuse identity.

Each recognized static path resolves with `resolve(repoRoot, value)` where `repoRoot` is the cwd from which the gate is invoked, and must exist before any synthetic flip can certify the gate. Malformed or unclassified wiring continues to exit 2 through the existing roster contract.

## Idiomatic patterns & pitfalls

- Reuse `existsSync`, `resolve`, the current `runCheck` parser, family roster, and flip registry.
- Extract quoted literals without splitting on commas inside quoted values; retain the raw source tail for dynamic-expression identity.
- Compare the ordered raw argv signature; flags, values, expressions and order are part of an invocation.
- Keep the explicit `all` selector exception local and named. Do not add a generic CLI schema or path registry.
- Do not compare production paths to synthetic fixture paths; bespoke flip argv remains necessary.

## Acceptance Criteria

- [ ] AC-1: An absence-family gate whose wired scan target does not exist fails the harness. Proven by inversion: with the target present the harness is green; with the wired argument pointed at a missing path it exits non-zero, and the assertion is shown NOT to be satisfied by the gate's own silent-return.
- [ ] AC-2: The `i18n raw strings` proof exercises the `--inventory` allowlist path, with a planted bad case that the allowlist must NOT excuse and a clean case it must.
- [ ] AC-3: `flipProofFor`'s script fallback resolves only when the wired argv is identical; a second wiring of the same script under different flags is UNCOVERED, not auto-certified. Proven by a synthetic second wiring.
- [ ] AC-4: Preserve #2560's stronger explicit-membership contract: every wired mechanism remains classified in exactly one of `ABSENCE_FAMILY_ROSTER`, `NOT_ABSENCE`, or `ABSENCE_EXEMPT`, and a synthetic no-signal gate still fails. Document CANON-25's separate binding of proofs to the real wired arguments.
- [ ] AC-5: No existing proof is weakened to accommodate the change; `node scripts/check-guard-flip.mjs` still reports `proven=25 vacuous=0 uncovered=0` (or higher) on the real tree.

## Non-Goals

- Deriving every proof's argv from the wiring — rejected above; it breaks the 14 bespoke-argv proofs and buys less than the existence assertion.
- Widening the absence family beyond the `check-no-*` / ratchet / parity shapes. That is a separate scoping decision; AC-4 only records the boundary.
- Fixing `check-no-placeholders.mjs`'s silent return on an unreadable directory. That is the #2512 / #2526 family and is being handled there; this issue is about the proof not seeing it.
- Any change to the CANON-24 ledger, its ceiling, or the family floor — all three landed with the #2301 review fixes.

## Merge contract

1. Acceptance: AC-1 through AC-5 above, frozen verbatim from issue #2572.
2. Policy: CANON-25, CANON-09, INV-53, INV-114 and INV-138. Missing real inputs and mismatched proof argv must fail closed.
3. Required tests: focused inversions for missing/present wired roots, equal/different argv fallback, i18n inventory behavior, and exhaustive explicit roster membership.
4. CI: focused Vitest and live harness during RED/GREEN; current L1; one final clean-HEAD L3; PR and main checks green.
5. Review: one independent reviewer on the frozen source SHA and one mechanical AC-fit verdict. All findings from a round become one fix batch.
6. Dependencies: `deriveAbsenceFamily`, `auditInversionRegistry`, and both harness callers retain their current authority; only the already-parsed invocation detail is added.

Landing route supported: yes — normal exact-SHA PR delivery after review and CI.

## Test strategy

| AC | Proof |
| --- | --- |
| AC-1 | Synthetic wiring with an existing root passes; the same wiring with a missing root fails before the silently-green child can certify it. Unit boundaries prove `src` is a path, `all` is a selector, `--inventory path` and `--config=path` are paths, while `--mode strict`, `--from origin/main --to HEAD`, dynamic runtime expressions, and unrecognized `--flag=value` forms are not. |
| AC-2 | The registered i18n bad fixture has an unrelated inventory row and fails; the clean fixture contains a matching inventory row and passes. |
| AC-3 | Same script + same empty argv reuses one proof; different flags, order, values, or dynamic raw expressions return no proof and are reported uncovered. A quoted comma-bearing value remains one literal. |
| AC-4 | Existing zero/duplicate/stale roster membership inversions remain green as tests of fail-closed behavior; CANON documents the current contract. |
| AC-5 | Live `check-guard-flip.mjs` and its complete focused suite pass without changing ledger/floor counts. |

The RED commit changes tests only and demonstrates the three current false-green counterexamples. GREEN makes the minimum harness and fixture changes. One execution unit covers the single proof-binding boundary.

## Risks

- A selector can be mistaken for a path. Mitigation: static-input recognition is deliberately narrow and retains the one current positional selector, `all`.
- A runtime-produced file can be checked before it exists. Mitigation: only static scan/config/inventory inputs are checked; coverage output remains excluded.
- The parser can lose comma-bearing string arguments. Mitigation: extract quoted literals rather than splitting the array body on commas.
- A future dynamic scan root cannot be checked statically. Accepted residual: dynamic inputs need an explicit executable fixture or a later typed wiring contract; this slice must not invent one.
