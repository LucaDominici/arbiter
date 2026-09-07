---
scenario: consumer-upgrade-delta
sha: ae40f0cf5f8bc78dac1fa8833a7db1e0708879cf
date: 2026-08-30
persona: Team lead on a governed project bumping arbiter a minor version, who must explain the diff to two reviewers before merging it
steps: 8
findings:
  blocker: 0
  major: 3
  minor: 2
---

# Tabletop — consumer-upgrade-delta

I'm bumping arbiter on a governed project that has local edits to a couple of generated
files, and I owe two reviewers a precise account of what this upgrade touches. I read
`docs/SEMVER.md` to learn the bump rules and the deprecation-window contract, then
`docs/DEPRECATIONS.md` to see what's due for removal — it tells me nothing is currently
deprecated, but three config fields in `src/wizard/types.ts` carry `@deprecated` tags that
never made it into that table, and the CI gate that's supposed to catch a removed
deprecated symbol only ever reads rows that are already there. I read `CHANGELOG.md`
against `SEMVER.md`'s own breaking-changes log and find the log names the wrong release for
its one recorded entry. Then I run the actual thing I care about — a dry-run `arbiter
update` against a materialized example that has one of my starting-state local edits — and
what I see contradicts the exact doc `SEMVER.md` points me to for what an upgrade
preserves: the promised per-line custom-marker merge for `AGENTS.md` doesn't exist anywhere
in the source; a diverged copy is withheld whole-file, which is safer than the doc claims
but not what the doc claims, and I'd have found out the hard way that my "preserved custom
content" got no governance updates at all.

| step | doc claim (path:line) | observed | severity | class | proposed permanent check | owner |
| ---- | --------------------- | -------- | -------- | ----- | ------------------------ | ----- |
| 7,8 | `docs/REFERENCE/file-stability.md:29-35` — AGENTS.md is **stable**; "Merge strategy: arbiter preserves lines between `<!-- arbiter:custom:start -->` and `<!-- arbiter:custom:end -->` markers on every `arbiter update`. Generated sections are regenerated." | `grep -rn "arbiter:custom:start" src/` returns zero hits — no marker-based merge exists in the codebase. Running `node dist/cli.js update --dir <copy of examples/ts-library> --adopt-plan` against a pristine copy classifies `AGENTS.md` as "always-rewrite — local edits are lost... AGENTS.md (backed up + replaced)"; against the same copy with one appended line, it moves to "would withhold... locally diverged, no adopt policy matches" — the *entire* file is frozen, not merged. `src/generators/safety-class.ts:56-82` documents the real mechanism: `GOVERNANCE_CLASS_KEYS` force-rewrites AGENTS.md only while pristine (#2056) and withholds it whole-file the instant it diverges (#2119/#2141's "superset principle" reversal), with no partial-merge path at all. The doc's specific mechanism (line-range markers) is not what runs; a consumer relying on it to keep custom notes AND receive governance updates gets neither the described merge nor a warning that governance content silently stopped updating | major | doc-drift | `__tests__/docs/file-stability-parity.test.ts`: drive `arbiter update --adopt-plan` against a fixture with a diverged `AGENTS.md` and assert the observed classification (regenerate/withhold) matches a machine-parsed reading of `file-stability.md`'s File Map row for that path, so the two can never independently drift again | #2447 |
| 4 | `docs/SEMVER.md:38-40` — the breaking-changes log's only row attributes the `GovernanceLevel` L1-L4 widening, the `$schemaVersion` 2→3 bump, and the `thresholds-l1-l2-l3.ts` rename to version **`1.0.0`** | `CHANGELOG.md` has no `## [1.0.0]` section — released versions stop at `## [0.5.0]`. The exact same change bundle (GovernanceLevel widened to include L4, evidence harness moved to L4-only, `$schemaVersion` bumped 2→3, threshold file renamed) is documented verbatim under `## [0.2.0] — 2026-06-21` (`CHANGELOG.md:483-508`, `feat(#1002)!`). `docs/SEMVER.md`'s own frontmatter `doc_version: '1.0.0'` (line 3) is the likely source of the mix-up — the doc's own version number was written into the "software version" column of its breaking-changes table. A consumer using this table to find out *when* they crossed this breaking change is told a release that was never cut, two majors after the one that actually shipped it | major | doc-drift | `scripts/check-semver-changelog-parity.mjs`: for every row in `docs/SEMVER.md`'s breaking-changes-log table, verify the cited version has a `## [<version>]` section in `CHANGELOG.md` and that the section mentions at least one of the row's named symbols/files | #2448 |
| 2,3 | `docs/DEPRECATIONS.md:22-24` — the Active Deprecations table: "_(none currently active)_"; `docs/DEPRECATIONS.md:49-54` — "How to Deprecate Something" step 1: "Add a row to the Active table above with `remove-in = current_major + 2`" | `grep -rn "@deprecated" src/wizard/types.ts` finds three live deprecated config fields with none of that process followed: `soloDevMode` (line 66, "Kept as alias for one minor version"), `enableSoloDevMode` (line 365, same note), and `ciTierMode` (line 447, "Kept for one minor version as a fallback alias" in favour of `pipelineStyle`) — none has a row in the Active table, none has a `deprecatedIn`/`removeIn` pair recorded anywhere, and `ciTierMode` is not named in `CHANGELOG.md` at all. `scripts/check-deprecations.mjs:12-56` only parses rows already present under `## Active Deprecations` and validates the separate `CLI_DEPRECATED_FLAGS` registry — it never scans `src/` for `@deprecated` JSDoc tags, so a config-field deprecation with no table row is invisible to the gate that is supposed to enforce the window. The scenario's exit criterion — "every deprecation listed carries a version and a removal window" — fails at the first clause: these three are not listed at all | major | missing-gate | `scripts/check-deprecations.mjs`: extend to `grep -rn "@deprecated" src/**/*.ts`, extract the tagged symbol name, and fail if it has no corresponding row in `docs/DEPRECATIONS.md`'s Active or Closed table | #2449 |
| 5 | `docs/REFERENCE/backward-compat-harness.md:56-61` — "Current fixture inventory" table lists exactly one fixture: `0.1.0 / ts-cli / typescript / v0.1.0-ts-cli` | `__tests__/fixtures/compat/MANIFEST.json` has two entries: `0.1.0-ts-cli` and `0.3.0-baseline` ("frozen v3-shape baseline for v3→v4 migration regression"); `__tests__/fixtures/compat/` also holds `v0.2.0-channel` and `v0.2.0-bad-channel` directories not indexed in MANIFEST.json or the doc table at all. The doc's own footnote ("Update this table when adding new fixtures... or rely on MANIFEST.json") concedes the table is optional, but a consumer who reads the doc table literally undercounts the harness's actual coverage by at least one release | minor | doc-drift | `scripts/check-ssot-core.mjs` (or a new light check): assert the row count in `backward-compat-harness.md`'s "Current fixture inventory" table equals `__tests__/fixtures/compat/MANIFEST.json`'s entry count | #2450 |
| 8 | `docs/REFERENCE/file-stability.md` File Map — enumerates per-file stability/merge behavior for every generated file a consumer might see change | `node dist/cli.js update --dir <copy> --adopt-plan` always classifies `.claude/knowledge-map.json` as "always-rewrite — local edits are lost" on every run in this walk, yet `grep -n "knowledge-map" docs/REFERENCE/file-stability.md` returns no hit — the file has no entry in the File Map at all. A consumer diffing exactly what changed on upgrade has no doc-level warning that this file resets unconditionally | minor | doc-drift | extend the same `file-stability-parity.test.ts` (from the AGENTS.md finding) to assert every manifest key that `arbiter update`'s plan classifies (regenerate/withhold/skip) on a representative fixture has a corresponding row in `file-stability.md`'s File Map | #2447 |

## Exit-criterion verdict: NOT MET

Neither half of the exit criterion holds. "Every deprecation listed carries a version and a
removal window" fails at the premise — three live `@deprecated` config fields in
`src/wizard/types.ts` are not listed in `docs/DEPRECATIONS.md` at all, and the gate that
should enforce the window (`scripts/check-deprecations.mjs`) structurally cannot see them
because it only reads rows the doc already has. "The dry-run's skip set matches what the
semver policy says an upgrade preserves" also fails: `docs/REFERENCE/file-stability.md` (the
file `docs/SEMVER.md` itself points to for per-file guarantees) promises a custom-marker
partial merge for `AGENTS.md` that has zero implementation in the codebase — the observed
dry-run behavior is a different, coarser mechanism (whole-file force-rewrite while pristine,
whole-file withhold once diverged) that happens to be safer for the persona's local edits
but is not the mechanism the doc describes, and leaves `.claude/knowledge-map.json`'s
always-rewrite behavior completely undocumented. A separate, unrelated-to-the-criterion but
consumer-relevant finding surfaced along the way: `docs/SEMVER.md`'s only breaking-changes-log
row cites software version `1.0.0` for a change `CHANGELOG.md` shows actually shipped in
`0.2.0` — likely the doc's own `doc_version` frontmatter bleeding into the table.

**Owner-column note:** findings were filed as tracked issues at integration time — #2447 (file-stability doc-drift, rows 1 and 8), #2448 (SEMVER breaking-log row), #2449 (deprecations table + gate blindness), #2450 (backward-compat fixture table) — and the owner cells above carry those numbers.

## Appendix — verbatim probe output

Pinned tree: `ae40f0cf5f8bc78dac1fa8833a7db1e0708879cf`, branch `docs/tabletop-consumer-upgrade-delta`.

`grep -rn "@deprecated" src/ --include="*.ts" | grep -v test` (steps 2–3):

```
src/wizard/types.ts:66:   * @deprecated Use collaborationMode: 'trunk-solo' instead. Kept as alias for one minor version.
src/wizard/types.ts:365:   * @deprecated Use collaborationMode: 'trunk-solo' instead. Kept as alias for one minor version.
src/wizard/types.ts:447:   * @deprecated Use pipelineStyle instead. Kept for one minor version as a fallback alias.
```

`grep -rn "warnDeprecated" src/ --include="*.ts" | grep -v deprecate.ts` (step 3) — zero callsites,
confirming the CLI-flag deprecation machinery in `src/internal/deprecate.ts` is wired but unused:

```
(no output)
```

`node scripts/check-api-snapshot.mjs` (step 6):

```
check-api-snapshot: OK — all snapshots match
```

`node dist/cli.js update --dir <scratch copy of examples/ts-library> --adopt-plan` (step 8),
pristine copy:

```
would regenerate 2 file(s) (always-rewrite — local edits are lost, prior content goes to <file>.arbiter-backup where the generator asks for a backup):
├── AGENTS.md (backed up + replaced)
├── .claude/knowledge-map.json

would withhold 3 file(s) (locally diverged, no adopt policy matches):
  - .gitignore
  - tsconfig.json
  - .prettierignore
Re-run without --adopt-plan to apply. Nothing was written.
```

Same command after appending one line to that copy's `AGENTS.md` (simulating the scenario's
starting-state local edit) — `AGENTS.md` moves from the regenerate bucket to the withhold
bucket, whole file, with a `fs.fix_withheld` stderr warning pointing at `arbiter diff --withheld`:

```
[warn] fs.fix_withheld user-modified, template fix NOT applied: AGENTS.md (review with `arbiter diff --withheld`; adopt every withheld fix with `arbiter update --adopt`) ...

would regenerate 1 file(s) (always-rewrite — local edits are lost, prior content goes to <file>.arbiter-backup where the generator asks for a backup):
├── .claude/knowledge-map.json

would withhold 4 file(s) (locally diverged, no adopt policy matches):
  - AGENTS.md
  - .gitignore
  - tsconfig.json
  - .prettierignore
Re-run without --adopt-plan to apply. Nothing was written.
```

`CHANGELOG.md:483-508` (step 4), the change SEMVER.md attributes to version 1.0.0, shown
under its actual release header:

```
## [0.2.0] — 2026-06-21
...
- feat(#1002)!: widen GovernanceLevel L1/L2/L3 → L1/L2/L3/L4; move evidence harness to L4-only
  ...
  - Config `$schemaVersion` bumped 2→3 (forward-only migration applied automatically on next read)
  - `src/config/thresholds-l1-l2-l3.ts` renamed to `src/config/thresholds-by-level.ts` (CANON-20)
```

`__tests__/fixtures/compat/MANIFEST.json` (step 5) vs. `backward-compat-harness.md`'s table
(one row, `0.1.0` only):

```json
[
  { "version": "0.1.0", "archetype": "ts-cli", "language": "typescript", "path": "v0.1.0-ts-cli" },
  { "version": "0.3.0", "archetype": "ts-cli", "language": "typescript", "path": "v0.3.0-baseline",
    "note": "frozen v3-shape baseline for v3→v4 migration regression" }
]
```
