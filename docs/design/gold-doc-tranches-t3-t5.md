---
title: 'Gold-Doc Tranches T3-T5 — skeleton generator, freshness gate, self-enrollment'
doc_version: '0.1.0'
status: draft
last_review: '2026-07-12'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related:
  [
    'docs/design/gold-doc-capability.md',
    'docs/design/gold-doc-self-tier-and-coherence.md',
    'standards/gold-doc-set.yml',
    'scripts/check-doc-set.mjs',
    'src/commands/doc-set.ts',
  ]
---

# Gold-Doc Tranches T3-T5 — skeleton generator, freshness gate, self-enrollment

**Design doc — not an implementation.** Detailed design for Tranches 3-5 of
`docs/design/gold-doc-capability.md` §8 (the parent). They close the parent's honesty findings
**H5** (body generator is a banner), **H4** (doc freshness is unimplemented) and **H6/H7** (self
passes a weak bar; coherence blind to CLI ghosts). Every anchor below was re-verified against the
current tree (`main` @ `d2c5d253` + the uncommitted Tranche-2 working-tree diff); where the parent's
anchors have drifted, the corrected line is given.

**Coordination:** `docs/design/gold-doc-self-tier-and-coherence.md` (the addendum) exists and is
authoritative for two pieces this doc would otherwise own: the **`tier_floor`** mechanism (addendum
§1, tranche T1b) and the **H7 coherence gate** (addendum §2, tranches T5b′/T5b″ — which explicitly
supersede the parent's §5.4 "extend check-emission-coherence" sketch). This doc does **not**
re-design them; T5 below consumes them and specifies what remains: charter-doc enrollment (parent
Tranche 5(a)) and the combined presence+freshness self-audit proof.

## 0. Baseline — what T0-T2 already delivered (verified)

| Piece                                                     | Where (verified)                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arbiter doc-set` CLI (T0/H1)                             | `src/cli.ts:884` (hidden command) → `src/commands/doc-set.ts` (thin wrapper, forwards engine verdict; parity test `__tests__/commands/doc-set.test.ts` pins "exactly one engine")                                                                             |
| `tiers{}` + column resolution (T1/H3)                     | `scripts/check-doc-set.mjs:160-201` (`TIER_COLUMN`, `resolveCollaborationMode`, `loadTierColumn`, `requirementFor` — fail-closed on malformed cell `:198-200`); manifest rows carry `tiers{}` + `freshness_class` (`standards/gold-doc-set.yml:14-26` header) |
| Subtree recognition (T2/H2, **uncommitted working tree**) | `scripts/check-doc-set.mjs:83-87` (`**` via `walkRepo`/`globToRegExp`), `:149-158` (`adrPresentAnywhere`), manifest `accept_any` widened (`standards/gold-doc-set.yml:146-156`)                                                                               |
| Governed thin runner                                      | `src/templates/scripts/check-doc-set.mjs.ejs` (spawn-array `'arbiter', 'doc-set'`); emitted via `UNCONDITIONAL_EMISSIONS` (`src/generators/check-all.ts:180-181`); wired advisory in governed check-all (`src/templates/scripts/check-all.mjs.ejs:1115-1119`) |
| Self wiring                                               | `scripts/check-all.mjs:355-356` — `doc-set presence` HARD `--strict` (INV-135)                                                                                                                                                                                |

**Live state of self (run on this tree):** `node scripts/check-doc-set.mjs --json` →
`tierColumn: "solo"`, `12/12 applicable, na: 36`. This confirms the addendum §1.1 live-red: self
currently grades itself against the SOLO column. T5 presupposes the addendum's `tier_floor` fix.

---

## 1. Tranche T3 — real skeleton generator, two-phase (closes H5)

### 1.1 Verified current state

- The only body arbiter can produce is `stubFor()` — frontmatter shell + one banner line
  `> **STUB — fill me in.**` (`scripts/check-doc-set.mjs:228-254`, banner at `:231-232`; the
  parent's `:143` anchor drifted under the T1/T2 diff).
- The manifest already reserves a **`template:` field** ("stub id used by --generate",
  `standards/gold-doc-set.yml:31`) and one row uses it (`template: glossary`, `:234`) — but the
  engine **never reads it** (no `check.template` reference anywhere in `check-doc-set.mjs`). It is
  a dormant binding point; T3 activates it.
- Real doc templates already exist for other families: `src/templates/docs/adr/ADR-000_template.md.ejs`
  (emitted by `src/generators/docs.ts:70-75`), `src/templates/docs/runbooks/{deployment,rollback,
troubleshooting,prod-checklist}.md.ejs`, steering/specs/bugs families. There is **no**
  `src/templates/docs/skeletons/` directory.
- Write machinery is ready: `writeFile` with `skipIfExists`/`dryRun`/hash-aware pristine +
  `withheld` semantics (`src/utils/fs.ts:127-165`, action table `:291-302`); `renderTemplate`
  (`src/utils/render.ts:133-137`); the generator fs-gate is `scripts/check-no-direct-fs-in-generators.mjs`.

### 1.2 Design — one resolution engine, a template catalog, and `--plan/--apply`

**Doctrine (from the T0 parity test): there is exactly one engine.** The generator must NOT
re-implement overlay/tiers/presence resolution in TypeScript. It **shells the engine** and consumes
its JSON verdict.

**(a) Engine JSON extension (additive).** `check-doc-set.mjs` adds to the `--json` report a
structured `missing` array alongside the existing string arrays (which stay untouched — the
`doc-set.test.ts` payload-parity test keeps passing):

```json
"missing": [
  { "path": "docs/operations/slo.md", "requirement": "mandatory",
    "template": "slo", "freshness_class": "operational" }
]
```

`src/commands/doc-set.ts` `DocSetPayload` (`:20-36`) gains the optional field — additive,
non-breaking.

**(b) Skeleton catalog** — `src/templates/docs/skeletons/*.md.ejs`, bound via the manifest's
dormant `template:` field. `template` accepts a string (tier-invariant) **or** a per-column map;
the generator resolves the variant with the payload's `tierColumn`:

| `template:` id   | solo / small                                                 | enterprise                                                    | Section skeleton (real headers + 1-line guidance each, no lorem)                                                                                                          |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arc42`          | `arc42-canvas` (single-page Canvas)                          | `arc42-full` (12 sections + C4 context/container section)     | Context · Constraints · Solution strategy · Building blocks · Runtime · Deployment · Decisions link · Quality · Risks                                                     |
| `adr-seed`       | same                                                         | same                                                          | Reuses `docs/adr/ADR-000_template.md.ejs` verbatim (MADR: Context · Decision · Consequences · superseded-by) — target `docs/ADR/ADR-000_template.md` for the dir/glob row |
| `prd`            | `prd-onepager` (Problem · What · Non-goals · Success signal) | `prd-full` (adds Personas · Requirements · Rollout · Metrics) | —                                                                                                                                                                         |
| `slo`            | `slo`                                                        | `slo`                                                         | Objectives · SLIs · Targets · Error budget · Alerting hooks                                                                                                               |
| `threat-model`   | `threat-model-4q` (four-question)                            | `threat-model-stride` (STRIDE table per component)            | —                                                                                                                                                                         |
| `er-model`       | `er-model`                                                   | `er-model`                                                    | Entities · Relations · Classification/PII columns · Retention                                                                                                             |
| `glossary`       | `glossary`                                                   | `glossary`                                                    | Term table (Term · Definition · Owner) — activates the existing `:234` binding                                                                                            |
| `test-strategy`  | `test-strategy`                                              | `test-strategy`                                               | Pyramid · Coverage policy · Gate mapping                                                                                                                                  |
| `governance`     | `governance`                                                 | `governance`                                                  | Decision rights · Gate ladder · Escalation                                                                                                                                |
| `technical-debt` | `technical-debt`                                             | `technical-debt`                                              | Register table (Item · Class · Interest · Plan) — T1b's landing cargo (addendum §1.5) reuses it                                                                           |

Rows **without** a `template:` binding are reported by `--apply` as
`no skeleton bound (engine --generate banner only)` — the banner never silently impersonates a
skeleton, and the catalog grows row-by-row instead of shipping ten lorem files at once. For
dir/glob rows (ADR), the catalog entry carries the target filename since `check.path` is a
directory.

**(c) New generator `src/generators/doc-set.ts`** — `generateDocSetSkeletons(config, opts)`:

1. Runs the engine via `runDocSet({ json: true, quiet: true, repo })` (the T0 wrapper — no direct
   spawn, no second engine).
2. For each `missing[]` entry with a bound template: resolve the tier variant, then
   `writeFile(resolvedPath(...), renderTemplate('docs/skeletons/<id>.md.ejs', config),
{ skipIfExists: true, dryRun })` — same shape as `src/generators/docs.ts`, so
   `check-no-direct-fs-in-generators.mjs` passes by construction.
3. **Banner-upgrade path:** if the target exists but is byte-equal to the engine's `stubFor()`
   banner output (machine-generated bytes — same test `--refresh-stubs` uses at
   `check-doc-set.mjs:284`), overwrite it with the real skeleton. A hand-edited file is never
   touched (the `withheld` path owns it).
4. Frontmatter of every skeleton is emitted conforming (`title`, `doc_version: 0.1.0`,
   `status: draft`, `last_review: <today>`, `owner`, `canonical_id`, `tags`, `related`) — so
   `check-doc-style.mjs` and the T4 freshness gate grade it from birth.
5. Registered in `src/generators/registry.ts` **immediately after** `gold-kit` (`:658-662`) as
   `key: 'doc-set-skeletons'`, enabled always — the manifest is on disk by the time it runs
   (writeFile is immediate in a real run). **dryRun edge (documented):** on a fresh
   `init --dry-run` the manifest is not yet on disk, the engine SKIPs, and the generator reports
   `skeletons: planned after manifest emission — run 'arbiter doc-set --plan' post-init`. Honest,
   no phantom plan.

**(d) Command surface** — `arbiter doc-set` gains `--plan` / `--apply` (options on the existing
hidden command; `src/commands/doc-set.ts` routes them to the generator instead of the engine
passthrough):

```bash
arbiter doc-set --plan    # table: present · would-scaffold(+template id) · unbound · withheld. Writes nothing.
arbiter doc-set --apply   # scaffolds missing bound skeletons (skipIfExists) + banner upgrades; reports withheld
```

`--plan` = `dryRun: true` through the same code path (the `src/utils/fs.ts` action table guarantees
plan/apply parity). Re-entry after user customization is `arbiter diff`/`update`'s three-way
surface — because the skeletons are emitted by a registered generator, the generated-manifest
records their hashes and a user-modified skeleton is `withheld`, never overwritten. Scope parity
with the engine's `--generate`: mandatory + recommended.

**Tier right-sizing is inherited, not re-implemented:** a `trunk-solo` repo never receives the
SLO/threat-model skeletons because those rows resolve to `skip` for its column inside the one
engine (`requirementFor`, `check-doc-set.mjs:192-201`) — they never appear in `missing[]`.

### 1.3 Red path — prova

- **RED today:** `arbiter doc-set --apply` does not exist as a flag; the only scaffold is the
  banner (`:231-232`).
- **Unit (fixture repo, small column + `deploys` overlay, no `docs/operations/slo.md`):**
  `--apply` writes a file whose body contains the real section headers
  (`## Objectives`, `## SLIs`, `## Error budget`) and NOT the string `STUB — fill me in`;
  `--plan` on the same fixture writes nothing (`git status --porcelain` empty) but lists the same
  path. Second `--apply` = no-op (idempotence).
- **Banner upgrade:** fixture containing a byte-equal banner stub → `--apply` replaces it; the same
  file with one edited character → reported `withheld`, bytes untouched.
- **Right-sizing:** trunk-solo fixture with SLA overlay off → `--plan` lists **no** SLO/threat-model
  rows (RED if the generator ever grows its own resolution).
- **Dogfood:** `arbiter doc-set --plan` on acme-team (peer-review = small): plan lists the small
  column's bound gaps; apply one, hand-edit it, run `arbiter diff` → `withheld`.

---

## 2. Tranche T4 — per-doc freshness gate (closes H4)

### 2.1 Verified current state — "no per-doc freshness gate" confirmed

- `scripts/check-monthly-freshness.mjs` reads **one CI stamp** (`.arbiter/monthly/last-run.json`,
  `:55-57`) with a vacuous pass when absent (`:63-68`). It never opens a doc. Wired in self gate at
  `scripts/check-all.mjs:244` (INV-82).
- `scripts/check-doc-style.mjs` requires the `last_review` **key** (`:66`) and validates its
  **format** when non-empty (`:157-163`) — an empty value or an ancient date passes.
- `gold-audit`'s `freshness()` helper (`scripts/lib/gold-audit-lib.mjs:1193`) measures **tool-report
  mtime** for value-checks — a different axis entirely (report liveness, not doc staleness).
- **Correction to the parent (§5.2 item 3):** it names `check-phase-doc-consistency.mjs` and
  `check-workflow-docs-sync.mjs` as the git-diff plumbing to reuse. Verified false — the former is
  the INV-113 dotfile-literal scan, the latter a workflow-filename↔docs listing; neither touches
  git. The repo's actual co-change gate is `scripts/check-docs.mjs` (merge-base diff `src/` vs
  `docs/`), but it is branch-scoped. Per-doc change-coupling needs full-history dates, so T4 uses
  `git log -1 --format=%cI -- <globs>` directly (below), not that plumbing.

### 2.2 Design — `scripts/check-doc-freshness.mjs` (binary, deterministic, banded by lane)

**Shared resolution lib (refactor, behavior-frozen):** extract from `check-doc-set.mjs` into
`scripts/lib/doc-set-resolve.mjs`: `TIER_COLUMN`/`resolveCollaborationMode`/`loadTierColumn`
(`:160-184`), `requirementFor` (`:186-201`), `loadOverlays` (`:218-226`), the glob/ADR presence
machinery (`:69-158`) — plus one new function the presence gate never needed:
`resolvePresentPaths(check) → string[]` (WHICH file(s) satisfied the check: first existing
`accept_any` candidate, glob matches via `walkRepo`, ADR files). `check-doc-set.mjs` re-imports;
the `doc-set.test.ts` engine-parity test pins that the move changes nothing. Presence and freshness
stay **two independent gates** (parent §1) sharing one resolution SSOT — the same pattern as
`gold-audit.mjs` over `gold-audit-lib.mjs`.

**Engine contract** (`node scripts/check-doc-freshness.mjs [--json] [--manifest P] [--profile P]`),
exit 0 fresh / 1 stale / 2 IO-config error (INV-53), fail-closed (INV-96), **no warning band inside
the script** — the verdict is binary; softness lives only in the wiring lane:

For every applicable required check (mandatory + recommended, after overlay + tiers resolution),
for every resolved present `.md` file:

1. **Clock = frontmatter `last_review`.** Missing block, missing/empty key, or unparseable date on
   a required doc ⇒ **STALE** (fail-closed; backfill exists: `scripts/docs-add-frontmatter.mjs`).
2. **Per-class max-age bar** from the row's `freshness_class` (in the manifest since T1):

   | class         | default bar                                                                                                                                                                           |
   | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `high-churn`  | 90d                                                                                                                                                                                   |
   | `operational` | 90d (incident-coupling refinement deferred — no deterministic incident source exists yet; noted, not faked)                                                                           |
   | `policy`      | 180d                                                                                                                                                                                  |
   | `regulatory`  | 365d                                                                                                                                                                                  |
   | `decision`    | age-exempt (immutable-once-accepted; ADR re-dating is the anti-pattern). The parent's `superseded-by`-link check is deferred to a later hardening — out of T4 scope, stated honestly. |

   Defaults live in the engine; a manifest-level `freshness_bars:` map may override per repo
   (enforcement level is data, not code — `docs/audit/ACTION_PLAN.md:28` doctrine).

3. **Change-coupling (strongest signal).** New optional per-check manifest field `couples_to:`
   (list of path globs — the code this doc describes). Verified: no such field exists anywhere
   today. Rule: `git log -1 --format=%cI -- <globs>` (last commit touching the coupled code) newer
   than `last_review` (day-granular, same-day passes) ⇒ **STALE**, regardless of the age bar.
   Deterministic against full history — no diff-range, no merge-base ambiguity.
   **Git edges (explicit):** not a git repo / git absent ⇒ coupling signal `skipped` (reported in
   `--json`), age bar still enforced; **shallow clone ⇒ same skip** (a depth-1 `git log -- path`
   lies) — detected via `git rev-parse --is-shallow-repository`. The CI job that runs this gate
   MUST checkout with `fetch-depth: 0` (wiring below).
4. **Exemptions:** non-`.md` targets (LICENSE, VERSION/package.json — no frontmatter);
   frontmatter `status: deprecated|archived` (a tombstone is not required to be fresh);
   `decision`-class rows per the table.

`--json` emits per-doc `{ path, class, last_review, age_days, bar, coupling: fresh|stale|skipped,
verdict }` — the audit-evidence shape.

### 2.3 Wiring — cadence non-push-blocking (solo-dev gate-model doctrine)

Freshness never blocks the per-push paved road (`docs/design/solo-developer-gate-model.md` — the
pre-push gate is the solo-dev's required check, `:111-117`; everything slower rides the async net,
`:128-132`). The monthly lane already exists on both sides (self `.github/workflows/08-monthly.yml`

- `_monthly.yml`; governed `src/templates/github/workflows/{08-monthly,_monthly}.yml.ejs`) and is
  liveness-asserted by the heartbeat (`09-heartbeat.yml.ejs:186-187`, ≤35d) — so worst-case rot is
  bounded by `bar + 35d` without touching pre-push latency.

| Surface                                               | Wiring                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self (industrial)                                     | New job in `_monthly.yml` (`fetch-depth: 0`): `node scripts/check-doc-freshness.mjs` HARD. Plus one HARD step in `05-release.yml` (release-tag blocking). **NOT** in `check-all.mjs` L2 — pre-push stays fast.                                                                                                                                                                                     |
| Governed engine access                                | No local engine copy: thin runner `src/templates/scripts/check-doc-freshness.mjs.ejs` shells `npx --no-install arbiter doc-set --freshness` (spawn-array), mirroring `check-doc-set.mjs.ejs`. Added to `UNCONDITIONAL_EMISSIONS` (`src/generators/check-all.ts`, beside `:180-181`).                                                                                                               |
| CLI surface                                           | **No new top-level command.** `--freshness` on `arbiter doc-set` routes the wrapper to the freshness engine script (`src/commands/doc-set.ts` selects the script path; everything else — runCli, exit forwarding, payload parse — is reused). Rationale: every new emitted `arbiter <sub>` is a phantom-scan + ledger liability (addendum §2.2-2.3); a flag on an already-ledgered command is not. |
| Governed banding (`pipelineStyle`, emission-time EJS) | `starter`: runner emitted, wired advisory in `_monthly.yml.ejs`; `standard`: monthly HARD; `industrial`: monthly HARD + release-workflow HARD. The script itself never softens — banding is purely where/how it is wired.                                                                                                                                                                          |
| Ledger (T5b″ coordination)                            | `standards/cli-emitted-surface.yml` row `doc-set` gains `emitted_by: [..., 'src/templates/scripts/check-doc-freshness.mjs.ejs']`. The addendum's extended phantom scan (spawn-array matcher over `src/templates/scripts/*.mjs.ejs`) covers the new runner automatically.                                                                                                                           |
| Stamp gate                                            | `check-monthly-freshness.mjs` is KEPT — it asserts the monthly lane itself ran (lane liveness); the new gate asserts docs are not rotten (content staleness). Different axes, both real.                                                                                                                                                                                                           |

### 2.4 Red path — prova

- **RED today:** no engine exists; nothing fails when `last_review` is years old
  (`check-doc-style` passes it as well-formed).
- **Age:** fixture manifest row `freshness_class: high-churn` + doc with `last_review: '2026-01-01'`
  (192d old at design date) → exit 1 naming path, age, and 90d bar. Same doc with
  `freshness_class: regulatory` → exit 0 (bar isolation).
- **Coupling:** fixture git repo — doc `couples_to: ['src/x.ts']`, commit touching `src/x.ts` dated
  after `last_review` → exit 1 with `coupling: stale`; re-date `last_review` past the commit →
  exit 0. Shallow-clone fixture → `coupling: skipped` in JSON, age-only verdict.
- **Fail-closed:** required doc present with empty `last_review` → exit 1.
- **Exemptions:** old ADR (`decision`) → exit 0; `status: archived` doc → exit 0.
- **Dogfood:** run on arbiter — charter + gold docs are graded by the very clock their frontmatter
  carries (this file's `last_review` included); confirm ADRs are not flagged.

---

## 3. Tranche T5 — self-enrollment + coherence (closes H6, H7)

### 3.1 What the addendum already owns (referenced, not re-designed)

- **`tier_floor: enterprise`** in `standards/doc-profile` with max() semantics — addendum §1
  (T1b). Verified still unlanded: live run above resolves `tierColumn: "solo"`. **T5 hard
  dependency:** without T1b, seven of the eight enterprise-column rows stay dormant on self and
  "self evaluates HARD" is theater.
- **H7 = phantom-command-scan extension + emitted-surface ledger + `arbiter mark` restore** —
  addendum §2 (T5b′/T5b″), which supersedes the parent §5.4 emission-coherence sketch (two drift
  models, two gates: file-paths stay with `check-emission-coherence.mjs`, command-existence with
  `check-phantom-command-scan.mjs` over the SSOT `cli.ts` parser). Nothing to add here except the
  T4 interlock already stated in §2.3 (ledger row + spawn-array coverage for the new runner).

### 3.2 Design — enroll the four charter docs (parent Tranche 5(a))

**The charter set** (verified on disk; tracked status matters):

| Doc                                                           | Tracked?           | class        | `couples_to`                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/research/enterprise-doc-standard-2026.md`               | yes                | `policy`     | —                                                                                                                                                                                       |
| `docs/methodology/agent-orchestration-and-context-hygiene.md` | yes                | `policy`     | —                                                                                                                                                                                       |
| `docs/design/gold-doc-capability.md`                          | **NO — untracked** | `high-churn` | `scripts/check-doc-set.mjs`, `scripts/lib/doc-set-resolve.mjs`, `src/commands/doc-set.ts`, `src/generators/doc-set.ts`, `scripts/check-doc-freshness.mjs`, `standards/gold-doc-set.yml` |
| `docs/design/gold-doc-self-tier-and-coherence.md`             | **NO — untracked** | `high-churn` | `scripts/check-phantom-command-scan.mjs`, `scripts/lib/cli-command-names.mjs`, `standards/doc-profile`                                                                                  |

(`git ls-files` returns only the first two; the two design docs — this file included — exist only
in the working tree. Local `existsSync` presence passes; a CI checkout goes RED. **The enrollment
PR must commit them** — durability is part of the tranche, not an afterthought.)

**Mechanism — a `self-charter` overlay, not always-rows:**

- `standards/doc-profile` (self): `overlays: [has-plugin-api, has-api, self-charter]`.
- `standards/gold-doc-set.yml` (self manifest **only** — verified: the governed manifest is a
  separate artifact rendered from `src/templates/standards/gold-doc-set.yml.ejs`, and no parity
  gate ties the two files; governed repos never see these rows): four new checks, one per charter
  doc — `applies: self-charter`, `tier: mandatory`, `tiers: { solo: 'R', small: 'R',
enterprise: 'R' }`, `freshness_class` + `couples_to` per the table, plus this file itself as a
  fifth row once it lands.

Why an overlay and not `applies: always`: charter paths are arbiter-specific; the overlay IS the
manifest's own trigger semantics (`check-doc-set.mjs:292` — `overlays.has(check.applies)`), it
keeps the enrollment inert for any repo that copies the manifest shape, and — because the engine
resolves overlay rows through the same `requirementFor` — all-R cells make enrollment **robust to
T1b landing order** (mandatory on self even while the column reads `solo`). The enterprise-column
raise for the _other_ eight rows remains T1b's job.

**Enforcement is already wired — no new wiring:** the rows flow into `missingMandatory`, and self
`check-all` runs the engine `--strict` HARD (`scripts/check-all.mjs:355-356`, INV-135). Freshness
of the same rows is T4's engine reading the same manifest — presence and freshness both bite the
charter from the day the rows exist.

### 3.3 Red path — prova ("self-audit verde solo se i fondativi sono presenti+freschi")

- **Presence, unit:** fixture dir with the self manifest + a profile enabling `self-charter` and
  none of the four files (engine takes `--manifest`/`--profile` overrides, `check-doc-set.mjs:66-67`)
  → `missingMandatory` lists all four, exit 1 under `--strict`. RED-by-construction today (rows
  absent, audit silent about the charter).
- **Presence, live:** after enrollment, `mv docs/design/gold-doc-capability.md /tmp/` →
  `check-all` (`doc-set presence` HARD step) goes RED naming the file; restore → GREEN.
- **Freshness, live (T4×T5 interlock):** commit a change to `scripts/check-doc-set.mjs` without
  re-dating `docs/design/gold-doc-capability.md` → monthly `check-doc-freshness` RED with
  `coupling: stale` on the capability doc; review + re-date → GREEN. This is H6's actual closure:
  the capability is governed by the gates it defines, on the column it preaches.
- **CI-durability:** the enrollment PR's own CI run is the proof the two untracked docs got
  committed (a local-only enrollment would pass locally and fail in CI checkout — the red path
  that catches "sealed but never landed").

---

## 4. Ordering, dependencies, tranche exit criteria

```
T1b (addendum §1: tier_floor + technical-debt cargo)   ← unlanded prerequisite for T5(a)'s bar
   │
T3 (skeleton generator)      — depends on T0 (command) + T1 (tiers in missing[]); independent of T4/T5
T4 (freshness gate)          — depends on T1 (freshness_class rows, landed); flag rides T0's command
T5b′ (phantom-scan ext)      — independent (addendum); should precede T4's new runner template, else
   │                            the spawn-array citation lands unscanned (bounded: ledger row covers it)
T5(a) (charter enrollment)   — after T1b; freshness bite requires T4; commits the two untracked docs
T5b″ (emitted-surface ledger) — follow-up (addendum); T4 appends its emitted_by row here
```

Recommended landing order: **T1b → T3 → T4 → T5b′ → T5(a)** (T5b″ trailing). Each tranche leaves
`check-all` green (parent §8 sequencing rule); model pyramid per the parent: Sonnet implements,
skeleton prose content included; Haiku does the mechanical manifest-row and catalog-table
transcription; verification stays with the orchestrator.

**Exit criteria (each = WIRED + TESTED-red-path + WORKING-dogfood):**

- **T3:** `arbiter doc-set --plan/--apply` live; ≥1 real skeleton per bound row of §1.2(b);
  banner-upgrade + withheld tests green; acme-team dogfood run recorded.
- **T4:** engine + shared-resolve refactor with frozen engine parity; monthly + release wiring on
  both self and governed templates; all §2.4 fixtures green; self monthly run produces the JSON
  evidence artifact.
- **T5:** four (five with this file) charter rows enrolled; both untracked design docs committed;
  §3.3 presence and freshness red paths demonstrated live; self `check-all` green on the
  enterprise column (T1b) with the charter enrolled.
