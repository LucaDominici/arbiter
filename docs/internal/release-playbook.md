---
title: 'Release Playbook'
doc_version: '1.7.0'
status: active
last_review: '2026-09-13'
owner: 'Luca Dominici'
canonical_id: ''
tags: ['audience/dev', 'kind/internal']
related: ['../QUICKSTART.md']
---

# Release Playbook

Arbiter publishes through `.github/workflows/05-release.yml` on a pushed `v*` tag,
excluding `v0.0.0-verify-*`. The npm job publishes to **latest** with provenance.
Manual dispatch runs only a read-only authentication smoke, even when dispatched
at a tag. It cannot build, sign or publish.

## Qualify the release candidate

Changesets remains the version and changelog authority: use `npm run changeset`
for a release entry and `npm run changeset:version` to apply the reviewed version
change, channel tag and changelog synchronization. Land that change through the
normal task, review, local gates and green CI. Do not add a second version bot.

Before tagging, retain the exact merged source SHA, accepted package artifact,
independent review and required consumer/install receipts. M1 additionally needs
its four package-manager couplings and actual consumer adoptions; a local green
gate or authentication smoke does not replace that acceptance. Resolve blocking
document freshness findings by reviewing their content and source coupling.

The release workflow builds and packs once, checks the package surface, hashes
that tarball, and passes the same bytes through signing and attestations. The
publisher waits for cosign, SLSA, native provenance, SBOM attestation and document
freshness; mutation, secret history and Trivy are prerequisites of signing.
A failure prevents publication. Keep the retained artifact and run URL together.

The INV-92 SBOM attestation is a **blob attestation**, not an image attestation: the release
artifact is a plain file (`release-artifact.tgz`), so `sbom-attest` uses `cosign attest-blob`
(not `cosign attest`, which resolves its subject as an OCI image reference and fails
`UNAUTHORIZED` against a registry for a file path — #2673). The bundle it produces
(`sbom.attestation.bundle`) is uploaded as a build artifact for audit but is not currently
re-verified by any CI step; to check it manually, download the bundle and the tarball from a
release run and run `cosign verify-blob-attestation --bundle sbom.attestation.bundle --type
cyclonedx --certificate-identity-regexp ".*" --certificate-oidc-issuer
"https://token.actions.githubusercontent.com" release-artifact.tgz`.

## Mutation surface debt (#2673)

The release workflow's `mutation-blocking` job had never gone green on any release run since
May: the full candidate mutation surface — `src/generators/**/*.ts` + `src/commands/init.ts` +
`src/invariants/catalog.ts` — is 9297 mutants. Measured on the actual self-hosted runner at
`concurrency: 2` (from a real failed run's own progress log): ~7.8s/mutant, so the full surface
needs many hours, not the job's 60-minute timeout. The orchestrator's decision: keep
`thresholds.break: 60` in `stryker.config.json` unchanged, and bound the mutated **surface**
instead of the score requirement.

Measured mutant counts per candidate scope (`npx stryker run --dryRunOnly --mutate <glob>`,
instrumentation count, before any test execution):

| Scope                                               | Files | Mutants  |
| --------------------------------------------------- | ----- | -------- |
| `src/invariants/catalog.ts`                         | 1     | 2482     |
| `src/commands/init.ts`                              | 1     | 143      |
| `src/generators/**/*.ts` (flat — no subdirectories) | 83    | 6672     |
| **Total (matches the CI log exactly)**              | 85    | **9297** |

**Mutant count alone is not the cost model.** A first pass ranked candidates purely by count and
by criticality (which generators emit CI/security-bearing output), landing on `init.ts` +
`github.ts` + `githooks.ts` + `gitignore.ts` (536 mutants). A real local `npx stryker run` to
completion on that scope showed the flaw: `github.ts`'s mutants are exercised by hundreds of
render/e2e tests under `perTest` coverage — each `github.ts` mutant took ~2 minutes to test,
against a few seconds for the other files' mutants. Projected total for that scope: >10 hours.
The run was killed; **per-mutant cost is per-file, not uniform**, and must be measured before a
file is included, not assumed from its mutant count:

| Candidate (in priority order)              | Mutants | Emits                                                                                                            | Included?                                                                   |
| ------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/commands/init.ts`                     | 143     | project scaffolding entry point                                                                                  | yes                                                                         |
| `src/generators/githooks.ts`               | 61      | `pre-commit`/`pre-push`/`commit-msg` hooks                                                                       | yes                                                                         |
| `src/generators/gitignore.ts`              | 13      | `.gitignore`                                                                                                     | yes                                                                         |
| `src/generators/security.ts`               | 53      | `.gitleaks.toml`, PII scanner, ZAP rules (the real secret-scan generator; `gitignore.ts`'s name is coincidental) | yes                                                                         |
| **Running total**                          | **270** |                                                                                                                  |                                                                             |
| `src/generators/github.ts`                 | 319     | every `.github/workflows/*.yml` render                                                                           | no — cheap by count, expensive to test (~2min/mutant, >10h projected total) |
| `src/generators/registry.ts`               | 535     | orchestrates every other generator (`arbiter init`/`update`'s dispatch hub); no templates of its own             | no — would alone exceed budget once `init.ts` is included                   |
| `src/generators/check-all.ts`              | 804     | `scripts/check-all.mjs` (the gate script itself)                                                                 | no — exceeds the whole budget alone by count                                |
| all other `src/generators/*.ts` (77 files) | 4887    | —                                                                                                                | no                                                                          |
| `src/invariants/catalog.ts`                | 2482    | the INV catalog (declarative data, not CI/security-emitting)                                                     | no — exceeds the whole budget alone by count                                |

Reconciliation against the 83-file generator total (`src/commands/init.ts` is not a generator, so
it is not part of the 83): 3 included generator files (`githooks.ts` + `gitignore.ts` +
`security.ts` = 127) + `github.ts` (319) + `registry.ts` (535) + `check-all.ts` (804) + the
remaining 77 files (4887) = **6672**, matching the 83-file generator total exactly. Grand total:
`init.ts` (143) + `catalog.ts` (2482) + generators (6672) = **9297**, matching the CI log.

`stryker.config.json`'s `mutate` is `init.ts` + `githooks.ts` + `gitignore.ts` + `security.ts` =
**270 mutants** across 4 files. Proven with two real local `npx stryker run` runs to completion
(not `--dryRunOnly`), `HOME=$(mktemp -d)`:

| Run | Concurrency | Elapsed | Score | Killed | Survived | No cov | Timed out |
| --- | ----------- | ------- | ----- | ------ | -------- | ------ | --------- |
| 1   | 4           | 60m 0s  | 67.41 | 182    | 75       | 13     | 0         |
| 2   | 6           | 45m 10s | 67.41 | 182    | 75       | 13     | 0         |

Survived-mutant breakdown per file at c=4 (the aggregate 67.41% clears `break: 60`, which is a
global not a per-file threshold; `init.ts` alone is below 60 and is the drag on the total, the
other three individually clear it): `init.ts` 58.74% (84 killed / 50 survived / 9 no-cov),
`githooks.ts` 72.13% (44/16/1), `gitignore.ts` 69.23% (9/4/0), `security.ts` 84.91% (45/5/3).

Run 1 at `concurrency: 4` measured **60 minutes 0 seconds wall time — exactly equal to the job's
60-minute budget, with zero margin** (the machine was also running other gates concurrently
during that measurement, which inflates the number somewhat but the equality is still too close
to trust in CI). Decision: raise `concurrency` to **6** (the self-hosted runner has 24 cores/62GB
and was still under-used at 4) for headroom; scope stays at 270 mutants. Run 2 at
`concurrency: 6` was proven to completion (`HOME=$(mktemp -d)`, same 270-mutant scope): **45
minutes 10 seconds**, same score 67.41 (182 killed / 75 survived / 13 no-cov / 0 timeouts / 0
errors) — identical kill/survive counts to run 1, as expected (concurrency changes wall time, not
which mutants are killed). Margin against the 60-minute job timeout is now **≈15 minutes**,
measured while the machine was contended (another repository's gate with Go race tests ran concurrently on the same machine), so
this is a conservative (not best-case) measurement. The next tag run on the actual CI runner is
still the final proof; this doc will be updated again if that number differs meaningfully.
Caution: `inPlace: true` instruments and mutates
the real working tree once, before workers start, then restores it afterward from
`.stryker-tmp/backup-*` — the real concurrency concern is not that instrumentation, it's that this
codebase self-applies its own generators in tests (the self-application/dogfood suite), and those
tests write real files as a side effect while workers run. The c=4 run proved this: test-generator
side effects clobbered real tracked files (`.githooks/*`, `.gitignore`, `.gitleaks.toml`,
`.claude/hooks/check-no-pii.mjs`), restored via `git checkout --` afterward. c=4 held with 0
errors/timeouts, which is not itself evidence that 2 more concurrent dogfood-writers hold too.

**Fallback plan if the tag run still times out at `concurrency: 6`, computed from the c=4 table
above (aggregate score = killed / (killed+survived+no-cov), so it stays checkable as scope
shrinks):** the released-scope order must preserve `break: 60`, and dropping the _highest_-scoring
file lowers the aggregate, not raises it. `security.ts` (84.91%) is the strongest scorer, not the
"cheapest to lose" — dropping it alone still clears the bar (killed 182-45=137, survived 75-5=70,
no-cov 13-3=10 → 137/(137+70+10) = 137/217 = **63.13%**, still ≥60 but with less margin than the
current 67.41%) but the doc must not claim it improves margin. `init.ts` (58.74%, 143 of 270
mutants) is the actual score drag: dropping it alone gives killed 182-84=98, survived 75-50=25,
no-cov 13-9=4 → 98/(98+25+4) = 98/127 = **77.17%**, the larger score improvement, at the cost of
losing coverage on the most critical file (project scaffolding entry point) and its share of
runtime (unmeasured per-file — the c=4 run did not report a per-file elapsed breakdown, only the
aggregate 60m 0s; do not assume `init.ts`'s share of the 270 mutants maps proportionally to its
share of the wall time under `perTest` coverage, the whole point of this doc is that mutant count
does not predict cost). This is a criticality-vs-margin call for the orchestrator to make at
incident time with a fresh `--dryRunOnly` recount, not a pre-committed two-step order — do not
treat `security.ts` then `githooks.ts` as a safe default; verify each step against `break: 60`
before dropping the next file.

**Timing model (measured, not assumed):** the CI log's own progress line (run `34754262536`)
gave ~7.8s/mutant wall-clock at `concurrency: 2`, but that figure came from cheap `catalog.ts`
mutants and does not hold for `github.ts`. There is no single s/mutant constant for this
codebase — cost is per-file, driven by how many tests cover each mutated line under `perTest`
coverage. The job's `timeout-minutes: 60` (`.github/workflows/05-release.yml`) is the only hard
ceiling; local elapsed time is the working estimate for it, to be verified by the next tag run on
the actual CI runner.

**Excluded surface (tracked as debt, not silently dropped), ranked by why each family didn't fit:**

- `src/generators/github.ts` (319 mutants, measured ~2min/mutant) — all CI workflow renders;
  excluded for **cost**, not criticality — it is the highest-priority family by output, but its
  test fan-out makes it the most expensive per mutant of anything measured. Stryker's
  `incremental` mode (cache unchanged mutants' results across runs) would let it be added back
  without paying its full cost every release, but **`incremental` is NOT enabled today** — this
  is documented future work, not a mitigation already in place.
- `src/generators/registry.ts` (535 mutants) — orchestrates every other generator (renders no
  templates itself); would alone push past budget once `init.ts` is included, so it can never
  coexist with the current required baseline under this cap.
- `src/generators/check-all.ts` (804 mutants) — emits the gate script itself (`check-all.mjs`);
  exceeds the entire budget alone by count, independent of anything else in scope.
- The remaining 77 `src/generators/*.ts` files (4887 mutants combined) — no individual file in
  this set emits CI/security-bearing output ranked above the four included files; excluded as a
  block, not individually evaluated beyond the per-file counts already measured.
- `src/invariants/catalog.ts` (2482 mutants) — a single large declarative catalog file, not a
  CI/security emitter; its own scope alone already exceeds the job budget by count.

Widening the included surface is future work, not blocked by anything in this doc, but must
measure **elapsed time to completion**, not just mutant count, before adding any file back —
`github.ts` is the clearest lesson: re-measure with a real `npx stryker run --mutate <file>` to
completion (a `--dryRunOnly` count is not sufficient) before changing the `mutate` list again.

## Package surface and size

What ships is pinned, its size is only reported (#2660). `package.json` `files` is a plain
whitelist: `dist`, the five shipped `scripts/*.mjs`, the five `scripts/lib` modules they
import, and the root documents. `npm run build` ends with `scripts/prune-dist-declarations.mjs`,
which keeps in `dist` only the `.d.ts` files tsc reaches from the four `exports` entry points
(19 declaration files) and deletes the rest, so no negation entry and no hand-kept list exist. `__tests__/scripts/pack-surface-2660.test.ts`
recomputes both closures on every run and fails when the shipped set drifts in either
direction; `__tests__/fixtures/pack-contract-2597.json` freezes the resulting roster.
`prepublishOnly` still runs `check-pack-size.mjs`, which prints the unpacked size and a WARN
line above 5,000,000 bytes but never fails: the hand-re-baselined budget (#511 → #1491 →
#2652) is gone. Measured at the re-pin: 4,362,750 bytes across 989 files (from 4,999,641 /
1,301).

## Configure npm authentication

The npm publisher uses a GitHub-hosted runner, Node from `.nvmrc`, and npm11.16.0.
Only this artifact-only job upgrades npm; the build retains its `packageManager`
pin. It downloads and verifies the signed tarball without rebuilding it.

For an existing npm package, configure a trusted publisher in its npm settings:
owner `LucaDominici`, repository `arbiter`, workflow filename `05-release.yml`.
The workflow grants `id-token: write` only where provenance/publication needs it.
No npm secret is inherited by the reusable SLSA workflow.

**(Round 2, #2679) OIDC only, no token in CI.** The trusted-publisher entry is
configured and `@getarbiter/cli` has already shipped a version through it
(0.5.0), so the earlier "initial publication may need `NPM_TOKEN`" case is
over. `publish-package` publishes exclusively via `npm publish --provenance`
under OIDC; there is no `NPM_TOKEN`/`NODE_AUTH_TOKEN` anywhere in the job or
step env, and no repo/org variable re-enables one — a settable-by-Write CI
variable gating a secret is not a control (a Write collaborator could flip it
without review). If OIDC publication ever fails (a broken trusted-publisher
binding, an npm outage), the recovery path is a **manual `npm publish`** run
by a maintainer from their own authenticated machine against the exact
retained, hash-verified `release-artifact.tgz` from the failed run — never a
CI-held token. Record that manual publish's `npm view` readback the same way
an automated one is recorded (see "Recovery" below).
See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).

## Restrict who can push a release tag

The in-workflow ancestry check (`build-superset`'s `ancestry-check` step) is
defense in depth only: a workflow executes at the content of the commit it was
triggered from, so a commit that is itself unreviewed can edit or delete that
exact step before its author pushes the tag. The check cannot be the
enforcing control against itself.

The enforcing control is a GitHub **tag ruleset** restricting who may create,
update, delete or force-push (non-fast-forward move) a `v*` tag, evaluated
server-side before any workflow runs. All four rules matter, not just
creation: `update`/`non_fast_forward` block re-pointing an already-pushed tag
to a different commit after the fact, and `deletion` blocks removing it to
push it again elsewhere — either would let someone route around a
correctly-created tag without ever triggering a new `creation` event.
Configure one (owner action, not something a workflow can set for itself; the
live ruleset on this repo is id `23168539`):

```bash
gh api --method POST repos/LucaDominici/arbiter/rulesets \
  -f name='release-tags' \
  -f target='tag' \
  -f enforcement='active' \
  -f 'conditions[ref_name][include][]=refs/tags/v*' \
  -f 'conditions[ref_name][exclude][]=refs/tags/v0.0.0-verify-*' \
  -f 'rules[][type]=creation' \
  -f 'rules[][type]=update' \
  -f 'rules[][type]=deletion' \
  -f 'rules[][type]=non_fast_forward' \
  -f 'bypass_actors[][actor_type]=RepositoryRole' \
  -f 'bypass_actors[][actor_id]=5' \
  -f 'bypass_actors[][bypass_mode]=always'
```

(`actor_id: 5` is the built-in "Admin" repository role; adjust to a specific
team/app id for a release team narrower than "admin".) A downstream project
generated from this template must configure the equivalent ruleset on its own
repository — the template cannot do this for a repo that does not exist yet.

**What the ruleset does NOT prevent:** it restricts _who_ can create/move/
delete a `v*` tag, not _which commit_ they point it at. An admin (or any
bypass actor) can still push a `v*` tag at a commit that never went through
review — the ruleset has no concept of "reachable from main". That gap is
exactly what `build-superset`'s in-workflow `ancestry-check` step catches
(defense in depth, per above): the ruleset stops an unauthorized _tag_, the
ancestry check stops an authorized tag pointed at the _wrong commit_. Neither
one alone is sufficient; both are required.

## Run the requested read-only smoke

```bash
gh workflow run 05-release.yml --ref main
gh run list --workflow 05-release.yml --event workflow_dispatch --limit 1
```

Inspect that exact run with `gh run view`. Authentication must succeed; the log
reports the authenticated username, scope visibility and only that user's role
when visible. `publicationAuthorization: NOT_PROVEN` is intentional: neither
whoami nor an organization role proves package publication permission or OIDC.
Missing/rejected authentication fails the smoke without exposing the token.

Every productive job, including the release aggregate, must be skipped. For a
manual-at-tag negative check, use a unique `v0.0.0-verify-*` tag at the qualified
commit: its push is excluded from release, and manual dispatch remains smoke-only.
Retain the run URL and all job conclusions, including an invalid-token failure.

## Publish and verify the installed bytes

Create the release tag only at the accepted merged SHA. Its name must exactly
match `v` plus `package.json.version`. The build checks checkout metadata; the
publisher reads the package manifest inside the retained tarball. Both refuse a
mismatch, including a version changed
by a prepack hook.
Pushing that tag starts the automatic release. The workflow publishes the retained
`release-artifact.tgz` using `npm publish --provenance --access public`, without
an alpha promotion step or a second local publish command. A prerelease tag is
also a `v*` trigger: do not use it as a publication-free rehearsal.

After the release run succeeds, inspect `npm view @getarbiter/cli dist-tags dist`,
install the exact published version in a fresh external directory, and execute
the documented quickstart and required consumer checks. Bind those receipts to
the version, registry integrity, release SHA and retained artifact. A successful
upload alone does not establish a successful consumer installation.

## Recovery

Do not retry publication with altered bytes under an already-published version.
For a failed job, fix its cause and retain the failed run before qualifying a new
candidate. If a published version is defective, deprecate that exact version,
restore the `latest` dist-tag to the previous qualified version and ship a new
version through the same pipeline. Record the affected version and recovery
receipts; do not report a rollback until registry readback confirms it.
