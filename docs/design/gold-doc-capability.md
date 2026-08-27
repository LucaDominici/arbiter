---
title: 'Gold-Doc Capability — self, generator, enforcer'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related:
  [
    'docs/research/enterprise-doc-standard-2026.md',
    'docs/methodology/agent-orchestration-and-context-hygiene.md',
    'standards/gold-doc-set.yml',
    'scripts/check-doc-set.mjs',
    'docs/REFERENCE/gold-doc-set.md',
  ]
---

# Gold-Doc Capability — self, generator, enforcer

**Design doc — not an implementation.** This turns the two normative foundations into one
buildable capability: arbiter (a) holds _itself_ to a gold doc-set and (b) generates + enforces
the _right-sized_ doc-set on every project it governs. It is written against the code that exists
today (anchors are `file:line`), and it is honest about which of those pieces are real, which are
advisory ceremony, and which are stubs.

**Implementation status (reviewed 2026-08-09).** `src/generators/doc-set.ts` implements the real
doc-body generator and formats its skeletons against the target configuration. `scripts/check-doc-
freshness.mjs` is implemented with age and coupling checks. The historical tranche descriptions
below record the design and its original red paths; they are not claims that those shipped surfaces
are still absent.

**Normative base**

- `docs/research/enterprise-doc-standard-2026.md` — the doc-type catalog, the TIER×doc-type matrix
  (§2, lines 193-234), the 12 promotion triggers (§3, lines 270-284), and the presence+freshness
  gate mapping (§4, lines 300-350). This is _what_ is true.
- `docs/methodology/agent-orchestration-and-context-hygiene.md` — the 15 measures and their
  arbiter mechanisms; the tier axis `solo=trunk-solo / team=peer-review / enterprise=gated-review`
  (§3, line 512); the never-scale-down floor `M9 + M15(a)` (lines 532-533); the HARD/SOFT/DOC
  enforcement legend (§0, lines 50-54). This is _how_ we enforce.

These two docs are themselves **the first two enterprise gold-docs** — a `kind/methodology` and a
`kind/standard`. Tranche 5 enrolls them (and this file) into arbiter's own manifest so the
capability governs its own charter.

---

## 1. Architecture at a glance

Three responsibilities, one manifest as the pivot.

```
                     standards/gold-doc-set.yml          ← the tier-parameterized catalog (SSOT)
                    (per-check: tiers{} · applies · phase · drivers · freshness_class)
                                   │
           ┌───────────────────────┼───────────────────────────┐
           │ SELF                   │ GENERATOR                  │ ENFORCER
           ▼                        ▼                            ▼
  arbiter's own repo runs    arbiter init/update SCAFFOLDS   two gates keep it honest:
  the ENTERPRISE column      the right-sized set into a      · presence  (check-doc-set)
  (dogfood reference impl)   governed repo, two-phase        · freshness (check-doc-freshness)
                             plan/apply, own-the-code        graduated advisory→soft→hard
                                   │                            │
                                   └──────────► gold-audit.mjs scorecard (roll-up, no-regress)
```

- **Manifest is the only source of truth.** Every catalog row (`README`, `arc42`, `ADR`, `SLO`,
  `DPIA`, …) compiles to one manifest check. The verdict is computed by code, never by an AI —
  same repo + same manifest ⇒ identical output (`scripts/check-doc-set.mjs:7-9`).
- **Self is the reference implementation.** Before the generator is pointed at any governed repo,
  arbiter's own repo must pass the enterprise column. That is the dogfood proof (methodology §4).
- **Generator scaffolds, never dictates.** Output is vanilla diffable Markdown/YAML; users own the
  code; the only thing they lose by ejecting is `update` (own-the-code doctrine,
  `docs/audit/IS-ARBITER-WORTH-IT.md:40`).
- **Enforcer is two independent gates.** Presence (does the required doc exist?) and non-staleness
  (has it rotted?). A present-but-rotted doc is worse than an absent one (standard §4, line 294).

### Self vs governed — the one asymmetry

|             | Self (arbiter repo)                                                                | Governed repo                                                                   |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Tier        | **Enterprise** always (a framework, published to npm, exposes a plugin API)        | Derived from `collaborationMode` — usually solo/small                           |
| Engine      | The **real** `scripts/check-doc-set.mjs` runs locally                              | A **thin runner** shells `arbiter doc-set` (no local `yaml` dep)                |
| Enforcement | Presence `--strict` HARD in `check-all` (`scripts/check-all.mjs:353-356`, INV-135) | Advisory in `check-all` (`src/generators/check-all.ts:174-181`) unless promoted |
| Freshness   | Release-blocking (industrial band)                                                 | Advisory (starter) → monthly (standard) → release-block (industrial)            |

The generated thin-runner path is deliberate: governed repos never take the `yaml` dependency, the
engine runs inside arbiter's own environment (`acme-consumer/scripts/check-doc-set.mjs` header). **Today
that path is broken** — see §7, honesty finding H1.

---

## 2. Tiering — right-sized, mapped to what already exists

The standard's three tiers already have a home in arbiter config; nothing new needs inventing for
the axis, only for the doc column.

**Team-size tier = `collaborationMode`** (the enum already exists,
`src/config/schema.ts:436-438`):

| Standard tier | `collaborationMode` | Doc posture                   |
| ------------- | ------------------- | ----------------------------- |
| SOLO          | `trunk-solo`        | Minimum Viable Documentation  |
| SMALL         | `peer-review`       | Paved-road docs-as-code       |
| ENTERPRISE    | `gated-review`      | Full doc-set + audit evidence |

**Enforcement band = `pipelineStyle`** — already derived from `collaborationMode × governanceLevel`
(`src/config/collaboration-mode-defaults.ts:28-47`) into `starter | standard | industrial`. We
reuse it verbatim as the strictness band so the doc gates inherit the same right-sizing the rest of
the pipeline already uses:

| `pipelineStyle` | Presence gate                                               | Freshness gate                        |
| --------------- | ----------------------------------------------------------- | ------------------------------------- |
| `starter`       | advisory (exit 0, report gaps)                              | advisory warning                      |
| `standard`      | soft — mandatory gap fails, grace-window eligible (ADR-028) | monthly gate                          |
| `industrial`    | hard — mandatory gap blocks                                 | release-tag blocking + audit evidence |

**Two axes, cleanly separated:** `collaborationMode` selects _which docs are required_ (the matrix
column); `pipelineStyle` selects _how hard the gate bites_. A solo repo at L4 still keeps the solo
doc column but gets a firmer freshness cadence — exactly the intent.

### Anti-cathedral guardrails (hard rules, not preferences)

Per standard lines 253-259 and methodology lines 532-533:

- A `trunk-solo` repo is **never** told it must carry SLO + error-budget, on-call doc-set, full
  STRIDE, traceability matrix, ISO-29119/42010, CODE_OF_CONDUCT, or CODEOWNERS. Absent trigger =
  **not present (dormant)**, never a gap.
- **`M9` (worktree isolation) and `M15(a)` (fail-closed default) never scale down** — but neither is
  a doc-set concern, so the doc gates are free to scale all the way down to advisory for solo.
- The 12 promotion triggers (§3) are the _only_ way an optional doc becomes required. They are
  detected from repo facts (config, file presence, git signals), never prose judgment.

> **This is the load-bearing fix.** Today every governed repo receives a tier-blind manifest that
> marks `README`, `docs/architecture/ARCHITECTURE.md`, `docs/GOVERNANCE.md`, `docs/SEMVER.md`, and
> `docs/coding-standards.md` as `mandatory` regardless of `collaborationMode`
> (`standards/gold-doc-set.yml:91-140`). A solo repo is thereby handed the cathedral the standard
> explicitly forbids. Tranche 1 removes this.

---

## 3. Tier → doc → gate matrix (the manifest schema evolution)

The catalog already carries `tier / applies / phase / drivers / accept_any / glob / adr / purpose`
per check (`standards/gold-doc-set.yml:9-26`). Two fields are added; one field's meaning is
clarified.

**New per-check fields:**

```yaml
- path: docs/operations/slo.md
  # NEW: the TIER×doc-type cell from standard §2 — R(required) | r(recommended) | o(optional) | '-'(n/a)
  tiers: { solo: '-', small: 'r', enterprise: 'R' }
  applies: sla-commitment # §3 trigger #7 overlay (promotes r→R / '-'→R when it fires)
  phase: operate
  drivers: ['iso12207']
  freshness_class: operational # NEW: selects the max-age bar (see §5)
  accept_any: ['docs/operations/slo.md', 'docs/operations/sla.md']
  purpose: SLO / SLA targets + error budgets.
```

**Field semantics:**

- `tiers{}` — the standard's matrix cell. `check-doc-set` resolves the repo's `collaborationMode`
  → column, then: `R ⇒ mandatory`, `r ⇒ recommended`, `o`/`-` ⇒ skipped (dormant, counted as N/A).
  This replaces today's flat `tier:` literal (which conflated enforcement strength with team size).
- `applies` — retained, but now unambiguously the **§3 trigger overlay**. When the trigger fires,
  the cell is promoted (an `r` or `-` becomes `R` for that repo) — this is the `⊕` of the matrix.
- `freshness_class` — one of `high-churn | policy | decision | operational | regulatory`, driving
  the freshness bar (§5). ADR/decision records are `decision` → immutable-once-accepted.
- `phase` + `drivers` — unchanged; they make the manifest a traceable, audit-ready map from each
  doc to _why_ it is required (ISO 12207 lifecycle + regulation vocabulary).

**Illustrative rows** (full transcription of standard §2 lines 195-234 lands in the manifest in
Tranche 1):

| Doc-type                                    | solo | small      | enterprise | trigger overlay                | freshness_class       |
| ------------------------------------------- | ---- | ---------- | ---------- | ------------------------------ | --------------------- |
| README                                      | R    | R          | R          | —                              | policy                |
| AGENTS.md                                   | R    | R          | R          | —                              | policy                |
| LICENSE / VERSION / CHANGELOG / SECURITY.md | R    | R          | R          | —                              | policy                |
| ADR / decision log                          | R    | R          | R          | —                              | decision              |
| Architecture (arc42 Canvas → full + C4)     | r    | R (Canvas) | R (full)   | `>2 deployable units` #6       | high-churn            |
| Coding standards                            | r    | R          | R          | —                              | policy                |
| Test strategy / coverage policy             | r/o  | R          | R          | —                              | policy                |
| CONTRIBUTING                                | o    | R          | R          | `2nd contributor` #4           | policy                |
| GOVERNANCE                                  | o    | r          | R          | —                              | policy                |
| GLOSSARY                                    | o    | r          | R          | `>12 ambiguous terms` #12      | policy                |
| PRD / RFC                                   | o    | r          | R          | `hard-to-reverse decision` #11 | high-churn            |
| OpenAPI / AsyncAPI                          | ⊕    | R⊕         | R⊕         | `has-api` #1                   | high-churn            |
| Data model / classification / PII           | ⊕    | R⊕         | R⊕         | `customer-data` #2/#3          | high-churn/regulatory |
| Threat model (4-Q → STRIDE)                 | o    | R          | R (STRIDE) | `public`/`customer-data` #3/#5 | policy                |
| SLO / on-call                               | -    | r          | R          | `SLA commitment` #7            | operational           |
| Postmortem                                  | o    | R          | R          | `first incident` #8            | operational           |
| SLSA provenance                             | -    | o          | R          | `publishes artifacts` #9       | regulatory            |
| Traceability / test plan (29119)            | -    | -          | R          | `regulatory mandate` #10       | regulatory            |
| Technical-debt register                     | o    | r          | R          | —                              | policy                |

Note the ⊕ column: a solo repo that ships an API (`has-api` trigger) _does_ get the OpenAPI
requirement — right-sizing is about defaults, not blanket exemptions.

---

## 4. The generator: from "fill me in" stub to real, two-phase, own-the-code

### 4.1 Historical baseline before the shipped tranches

At design time there was **no `src/generators/doc-set.ts`.** The doc-generation surface was split
across two places:

1. **`src/generators/gold-kit.ts:51-90`** — `generateGoldKit()` emits the _manifest and profile_
   into a governed repo (`gold-doc-set.yml`, `doc-profile`, `gold-registry.yml`, `thresholds.yml`)
   plus the thin `gold-audit.mjs` runner. All `skipIfExists` (`:63,72`). Registered in
   `src/generators/registry.ts:658-662` under key `gold-kit`. It emits **no doc bodies.**
2. **`scripts/check-doc-set.mjs:139-165` (`stubFor`)** — `--generate` scaffolds a _body_, but the
   body is a one-line banner: `> **STUB — fill me in.**` (`:143`). It is write-safe (only writes a
   MISSING file, `:218`; `--refresh-stubs` overwrites only a byte-equal stub, `:194-197`).

So "the generator is a stub 'fill me in'" is literally true: the only body arbiter can produce is a
frontmatter shell + a fill-me-in banner. That is presence-satisfying but content-empty.

### 4.2 Target design: a real doc-body generator, riding the existing two-phase engine

Do **not** build a new update engine — ride `arbiter diff` (plan, `src/cli.ts:676`) and
`arbiter update` (apply, `src/cli.ts:581`). That engine is already real: hash-aware pristine
propagation, `withheld` for user-modified files, two-phase diff=plan/update=apply
(`docs/audit/FRAMEWORK_AUDIT.md:72`, `src/commands/update.ts`). The doc generator becomes a
generator that plugs into it, inheriting own-the-code for free.

**Per-doc-type skeleton templates** (`src/templates/docs/skeletons/*.ejs`), each a _real_ section
scaffold, not a banner — right-sized by `collaborationMode`:

- `arc42.md.ejs` — solo emits the **arc42 Canvas** (single page); enterprise emits the full
  12-section template + a C4 context/container skeleton.
- `adr/ADR-000_template.md.ejs` — MADR v4 (context · decision · consequences · `superseded-by`).
  (An ADR template emitter already exists at `src/generators/docs.ts:68-74` — reuse it.)
- `prd.md.ejs` — 1-pager (problem · what · non-goals) for small; full PRD for enterprise.
- `operations/slo.md.ejs`, `security/threat-model.md.ejs`, `data/er-model.md.ejs`, … — one skeleton
  per conditional family, emitted only when the trigger overlay fires.

**Two-phase contract (new `arbiter doc-set` command — see Tranche 0):**

```bash
arbiter doc-set --plan     # dry-run: table of {present · would-scaffold · stale · withheld}. Writes nothing.
arbiter doc-set --apply    # scaffolds missing required skeletons (skipIfExists); reports withheld user-modified
arbiter doc-set --json     # machine-readable audit (presence + freshness roll-up)
```

`--plan`/`--apply` map onto `writeFile(..., { dryRun })` which the generators already thread
(`src/generators/gold-kit.ts:53,63`). Idempotence and own-the-code come from `skipIfExists`; the
re-entry path for a customized doc is `arbiter diff`/`update`'s three-way surface, not a blind
overwrite. **No file is ever overwritten without a reviewed diff.**

### 4.3 `check-no-direct-fs` compliance

Generators must not touch `fs` directly (there is a gate: `scripts/check-no-direct-fs.mjs`, which since #1991 covers all of `src/`, not just generators).
The doc skeletons go through `writeFile`/`resolvedPath`/`renderTemplate` exactly as
`src/generators/docs.ts` and `gold-kit.ts` already do — the design adds templates + a generator
function, not raw writes.

---

## 5. Enforcement — graduated, fail-closed, without editing the rule body

### 5.1 Presence gate (mostly exists)

`scripts/check-doc-set.mjs` is the engine. It already does overlays (`:129-137`), `accept_any`
(`:120-127`), glob + ADR dual-recognition (`:98-118`), `--strict` (`:256`), and `--generate`
(`:214-222`). What changes: it resolves the required set from `tiers{}` × `collaborationMode`
instead of the flat `tier:` literal, and it reads `collaborationMode` from `arbiter.json`.

- **Self** wires it HARD (`--strict`) in `scripts/check-all.mjs:353-356` (INV-135). Keep.
- **Governed** wires it via the thin runner at the `pipelineStyle` band
  (`src/generators/check-all.ts:174-181`): `starter` advisory, `standard` soft (grace-eligible),
  `industrial` `--strict`.

### 5.2 Freshness gate (historical design)

**Historical status:** there was no per-doc freshness gate when this design was written.
`scripts/check-monthly-freshness.mjs` checks a single CI **stamp** artifact
(`.arbiter/monthly/last-run.json`, `:55-57`) — it never opens a doc.
`scripts/check-doc-style.mjs:157-163` validates that `last_review` is ISO-**formatted** when set,
but never checks its **age**. So "non-staleness" is currently a claim, not a gate.

**New `scripts/check-doc-freshness.mjs`** — deterministic, fail-closed (INV-96), exit
0 fresh/advisory / 1 stale / 2 IO-error (INV-53):

1. **Frontmatter is the clock.** Read `last_review` (already backfillable via
   `scripts/docs-add-frontmatter.mjs`) per required doc.
2. **Per-class max-age bar** from the manifest `freshness_class` (standard §4 lines 333-338):
   `high-churn ≤ 90d` · `policy ≤ 180d` · `regulatory ≤ 365d` · `operational ≤ 90d + last-incident`
   · `decision` immutable-once-Accepted (freshness = presence of a `superseded-by` link, never
   re-dating).
3. **Change-coupling** (strongest signal): a `phase: design` doc whose companion code changed in the
   diff but whose `last_review` did not = stale. This mirrors the existing pattern in
   `scripts/check-phase-doc-consistency.mjs` and `scripts/check-workflow-docs-sync.mjs` — reuse the
   git-diff plumbing, don't reinvent it.
4. **Graduated by `pipelineStyle`:** `starter` advisory-warning · `standard` monthly gate ·
   `industrial` release-tag blocking. This is the paved-road cadence from
   `docs/design/solo-developer-gate-model.md` — freshness never per-commit-blocks the solo road.

### 5.3 Advisory → soft → hard without touching the rule body (Sentinel doctrine)

The methodology's HARD/SOFT/DOC legend (§0, lines 50-54) and the existing grace-window machinery
(ADR-028: `soft: graceActive` prints `WARN (grace period)`, exits 0, hard-fails on expiry —
`docs/internal/ADR/028-*.md:53`) are the enforcement ladder. A doc-type is promoted from advisory
to hard by **flipping its band**, never by editing the check. The check body reads the band; it
does not encode a per-doc severity. This is the "enforcement level is data, not code" rule
(`docs/audit/ACTION_PLAN.md:28`).

**Self-pruning (reverse trigger, standard §3 lines 286-289):** a mandatory doc-gate bypassed
`> N/month` (default 3) auto-flags the doc-type for **demotion** review — the bypass-log-as-ceremony
detector (methodology M15(b)). This kills the "305 docs-gate bypasses" failure mode
(`docs/audit/LAST-CHANCE-VERDICT.md:80`) structurally: a gate nobody honors demotes itself instead
of rotting into broken-warnings.

### 5.4 Coherence — a gate the emission checker cannot currently catch

`scripts/check-emission-coherence.mjs` (INV-123) verifies every _referenced file_ resolves
(`:348-361`) and every emitted script is referenced (`:291-341`). But it resolves **file paths**,
not **`arbiter <subcommand>` invocations** — which is exactly why the broken `arbiter doc-set`
runner (§7 H1) shipped invisibly. Tranche 5 adds a check (or extends emission-coherence) that every
`npx arbiter <sub>` shelled from a generated runner resolves to a registered `cli.ts` command. <!-- install-command-allow: emitted runner's own `npx --no-install arbiter <sub>` spawn, never a user-facing install -->

---

## 6. Dogfood — real runs, real evidence

**Acceptance test = `arbiter <cmd>` runs on a real governed repo and produces true output.** These
were executed against the current tree.

### 6.1 Self (arbiter, enterprise) — the engine works

`node scripts/check-doc-set.mjs --json` →
`{ applicable: 20, present: 19, missingMandatory: 0, missingRecommended: 1 (docs/technical-debt.md), na: 28 }`.
The engine is real and green. **Caveat (honesty):** this passes a _tier-blind_ manifest — the "20
applicable" are today's flat mandatory+recommended set, **not** the enterprise column of the
standard. Self is green against a weaker bar than the one it should carry. Tranche 5 raises self to
the true enterprise column (and enrolls the two foundational docs + this file).

### 6.2 Governed (acme-consumer, `trunk-solo`=SOLO, L2) — the runner is broken

`node acme-consumer/scripts/check-doc-set.mjs --json` → **`error: unknown command 'doc-set'`.** The
generated runner shells <!-- install-command-allow: emitted `npx --no-install arbiter <sub>`, not a user-facing install --> `npx arbiter doc-set` (`acme-consumer/scripts/check-doc-set.mjs:22`), but no such
command exists (`src/cli.ts` has `gold-audit` at `:831`, no `doc-set`). **The governed-side
presence gate has never functioned.** This is finding H1.

### 6.3 The acme-consumer-budget recognition test — does the standard's engine see gold work?

The freshly-produced acme-consumer budget architecture doc-set is real, conformant enterprise-grade content:
`acme-consumer/docs/architecture/budget/` = `arc42.md` (35k), `c4-model.md` (9.5k), `README.md`, and **9
ADRs** under `adr/ADR-006…ADR-014_*.md`. By the standard (§1 architecture + decisions), this is
exactly what the arc42+C4+ADR requirements ask for.

**Would the current manifest recognize it? No.** The architecture check's `accept_any` is
`docs/architecture/ARCHITECTURE.md | arc42.md | blueprint.md | docs/ARCHITECTURE.md`
(`standards/gold-doc-set.yml:96-102`) — it does **not** include the `budget/` subtree. The ADR check
globs `docs/ADR/[0-9]*.md` (`:109`), but acme-consumer's ADRs live at `docs/architecture/budget/adr/`. So a
working engine would still report acme-consumer as _missing_ arc42 and ADRs while a 35k arc42 and 9 ADRs sit
one directory deeper. This is finding H2 (path-blindness) — Tranche 2 fixes recognition breadth so
subtree arc42/C4/ADR count.

---

## 7. Historical gap inventory (iron-law)

| #   | Finding                                                                                                                              | Evidence                                                                            | Severity                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------- |
| H1  | **Governed presence gate is dead** — thin runner shells a non-existent `arbiter doc-set`                                             | `acme-consumer/scripts/check-doc-set.mjs:22` vs `src/cli.ts` (no `doc-set` command) | Blocker                   |
| H2  | **Manifest is path-blind** — subtree arc42/C4/ADR (acme-consumer `budget/`) not recognized                                           | `standards/gold-doc-set.yml:96-102,109`                                             | High                      |
| H3  | **Manifest is tier-blind** — no solo/small/enterprise column; every governed repo gets the cathedral                                 | `standards/gold-doc-set.yml:91-140` (all `mandatory`)                               | High                      |
| H4  | **Doc freshness is unimplemented** — `check-monthly-freshness` reads a CI stamp, `check-doc-style` reads only `last_review` _format_ | `scripts/check-monthly-freshness.mjs:55-57`, `scripts/check-doc-style.mjs:157-163`  | High                      |
| H5  | **Body generator is a banner** — `--generate` writes `> **STUB — fill me in.**`, no real skeletons, no two-phase                     | `scripts/check-doc-set.mjs:143`                                                     | Medium                    |
| H6  | **Self passes a weak bar** — green against tier-blind manifest, not the enterprise column                                            | §6.1                                                                                | Medium                    |
| H7  | **Coherence blind to CLI-subcommand ghosts** — emission-coherence resolves file paths, not `arbiter <sub>`                           | `scripts/check-emission-coherence.mjs:348-361`                                      | Medium (root cause of H1) |

None of these was fatal to the design — they were precisely the wiring the tranches below installed.
This table remains the historical rationale; it is not a claim that the shipped generator, tiering,
freshness, or enrolled charter surfaces are still absent.

---

## 8. Historical implementation spec — tranches (each WIRED + TESTED-red-path + WORKING-dogfood)

Ordered so each tranche is independently shippable and leaves the tree green. Model tier per the
pyramid: Sonnet implements; Opus verifies the plan; Haiku does mechanical transcription (the §2
matrix rows).

### Tranche 0 — Unblock: the `arbiter doc-set` command (fixes H1)

- **Build:** add `src/commands/doc-set.ts` mirroring `src/commands/gold-audit.ts` (thin wrapper over
  the `scripts/check-doc-set.mjs` engine); register `.command('doc-set [repo]')` in `src/cli.ts`
  next to `gold-audit` (`:831`).
- **Wired:** `src/cli.ts` command registration; the existing governed runner
  (`acme-consumer/scripts/check-doc-set.mjs:22`) now resolves.
- **Tested (red path):** a test that `arbiter doc-set --json` on a fixture repo returns an audit
  payload — RED today (`unknown command 'doc-set'`), GREEN after.
- **Dogfood/proof:** re-run §6.2 on acme-consumer → real JSON, not an error.

### Tranche 1 — Tier axis: `tiers{}` in the manifest + collaborationMode resolution (fixes H3)

- **Build:** add `tiers{}` + `freshness_class` to the manifest schema; transcribe standard §2 lines
  195-234 (Haiku); in `check-doc-set.mjs`, read `collaborationMode` from `arbiter.json`, resolve the
  column, map `R→mandatory / r→recommended / o,-→skip`. Update `src/templates/standards/gold-doc-set.yml.ejs`.
- **Wired:** `check-doc-set.mjs` `isPresent`/tier-resolution path; `gold-kit.ts` re-emits the
  tier-aware manifest.
- **Tested (red path):** fixture solo repo with **no** `docs/architecture/ARCHITECTURE.md` and no
  `docs/GOVERNANCE.md` → **0 mandatory gaps** (RED today: both reported missing-mandatory).
- **Dogfood/proof:** acme-consumer (solo) audit no longer demands GOVERNANCE/SEMVER/full-arch; acme-team
  (peer-review=small) gets the small column.

### Tranche 2 — Recognition breadth: subtree arc42/C4/ADR (fixes H2)

- **Build:** widen `accept_any`/`glob` to recognize `docs/architecture/**/arc42.md`,
  `docs/**/c4-model.md`, and `docs/**/adr/ADR-*.md`; keep the ADR dual-recognition regexes
  (`check-doc-set.mjs:103-118`).
- **Tested (red path):** fixture with arc42+9 ADRs under a `budget/` subtree → architecture + ADR
  checks PASS (RED today).
- **Dogfood/proof:** re-run §6.3 on acme-consumer → arc42 + ADRs recognized; present-count rises.

### Tranche 3 — Real body generator + two-phase (fixes H5)

- **Build:** `src/templates/docs/skeletons/*.ejs` (arc42 Canvas/full, MADR ADR, PRD 1-pager, SLO,
  threat-model, ER-model), right-sized by tier; new `src/generators/doc-set.ts` that emits the
  right skeletons through `writeFile({dryRun})`; wire `arbiter doc-set --plan/--apply` onto it;
  register in `registry.ts`.
- **Wired:** `registry.ts` generator entry; `--plan`/`--apply` in `src/commands/doc-set.ts`; rides
  `arbiter diff`/`update` for re-entry.
- **Tested (red path):** `arbiter doc-set --apply` on a fixture missing `docs/operations/slo.md`
  (small + SLA trigger) writes a skeleton with **real section headers** (Objectives/SLIs/Error
  budget), not a `fill me in` banner; `--plan` writes nothing (RED: today only the banner exists).
- **Dogfood/proof:** generate the SLO skeleton on acme-team; confirm `arbiter diff` treats a
  subsequent user edit as `withheld`, not overwritten.

### Tranche 4 — Freshness gate (fixes H4)

- **Build:** `scripts/check-doc-freshness.mjs` (per-doc `last_review` age vs `freshness_class` bar +
  change-coupling via git-diff); template `.ejs`; wire into self `check-all.mjs` and governed
  `check-all.ts` at the `pipelineStyle` band. Extend `check-doc-style.mjs` to require `last_review`
  present (not just well-formed) on required docs.
- **Tested (red path):** fixture doc `freshness_class: high-churn`, `last_review` 200 days ago →
  STALE FAIL under `industrial`, advisory-WARN under `starter` (RED today: no such gate).
- **Dogfood/proof:** run on arbiter (enterprise) → surfaces any gold-doc past its bar (this file's
  `last_review` is the clock); confirm ADRs are exempt (immutable) not flagged.

### Tranche 5 — Self-enrollment + coherence hardening (fixes H6, H7)

- **Build:** (a) enroll `docs/research/enterprise-doc-standard-2026.md`,
  `docs/methodology/agent-orchestration-and-context-hygiene.md`, and this file into arbiter's own
  manifest as enterprise gold-docs; raise self `doc-profile` to the true enterprise column; (b) add a
  <!-- install-command-allow: emitted `npx --no-install arbiter <sub>`, not a user-facing install -->
  coherence check that every `npx arbiter <sub>` in a generated runner resolves to a registered
  command (closes the H1 class).
- **Tested (red path):** removing the `doc-set` command → the new coherence check FAILs (RED: today
  it passes silently).
- **Dogfood/proof:** self `check-all` green against the enterprise column; the two foundational docs
  are now presence+freshness-gated by the capability they define (self-governance closes).

---

## 9. Historical gap list — HAS vs MISSING

**HAS (build on, do not replace):**

- Presence engine — `scripts/check-doc-set.mjs` (overlays, accept_any, glob, ADR dual-recognition,
  write-safe `--generate`, `--strict`). Self-wired HARD (`check-all.mjs:353-356`, INV-135).
- Rich manifest — `standards/gold-doc-set.yml` (`phase` + `drivers` + `purpose` + `accept_any`).
- Manifest+profile generator — `src/generators/gold-kit.ts` (`registry.ts:658-662`, `skipIfExists`,
  `dryRun`-threaded).
- Governed thin-runner wiring — `src/generators/check-all.ts:174-181` (advisory band).
- Scorecard roll-up — `scripts/gold-audit.mjs` (`--check` no-regress, baseline ratchet, `--strict`
  false-gap; a `freshness` helper is already imported, `:51`).
- Tier axis config — `collaborationMode` (`schema.ts:436-438`) × `pipelineStyle`
  (`collaboration-mode-defaults.ts:28-47`).
- Two-phase own-the-code engine — `arbiter diff`/`update` (`cli.ts:676,581`; `update.ts`).
- Frontmatter discipline — `check-doc-style.mjs` (`last_review` format), `docs-add-frontmatter.mjs`
  (backfill).
- Emission/orchestrator coherence — `check-emission-coherence.mjs` (INV-123),
  `check-orchestrator-coverage.mjs` (#1410).
- Enforcement ladder — HARD/SOFT/DOC legend + grace-window (ADR-028).

**MISSING (build):**

- `arbiter doc-set` CLI command (H1) — **Tranche 0.**
- `tiers{}` + `freshness_class` manifest fields + collaborationMode column resolution (H3) —
  **Tranche 1.**
- Subtree arc42/C4/ADR recognition (H2) — **Tranche 2.**
- Real per-doc-type skeleton templates + `doc-set.ts` generator + `--plan/--apply` (H5) —
  **Tranche 3.**
- `scripts/check-doc-freshness.mjs` — per-doc age + change-coupling, banded (H4) — **Tranche 4.**
- Self-enrollment of the 3 charter docs + enterprise column + CLI-subcommand coherence check (H6,
  H7) — **Tranche 5.**
- Bypass-log self-pruning / demotion trigger (methodology M15(b)) — folds into the freshness/scorecard
  roll-up; schedule after Tranche 4.

**Sequencing rule:** Tranche 0 first (nothing else is observable until the command exists), then
1→2 (recognition), then 3 (generation), then 4 (freshness), then 5 (self + coherence). Each leaves
`./run.sh` / `check-all` green.
