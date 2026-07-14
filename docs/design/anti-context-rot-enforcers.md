---
title: 'Anti-Context-Rot Enforcers — Design of the TO-CREATE Gate Set'
doc_version: '0.1.0'
status: draft
last_review: '2026-07-12'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related:
  [
    'docs/methodology/agent-orchestration-and-context-hygiene.md',
    'docs/EXECUTION-PLAYBOOK.md',
    'GLOBAL_INVARIANTS.md',
    'scripts/check-all.mjs',
    'schemas/evidence-bundle.schema.json',
    '.claude/rules/50-batch-execution.md',
  ]
---

# Anti-Context-Rot Enforcers — Design of the TO-CREATE Gate Set

**Source method:** `docs/methodology/agent-orchestration-and-context-hygiene.md` (15 measures
M1–M15; appendix §5 maps each to EXISTS / PARTIAL / TO-CREATE).
**This doc:** the implementation design for every TO-CREATE enforcer — what it is, where it
wires (`file:line` against main @2fe61044), its red-path proof, its self-vs-governed split,
and its tier right-sizing. Nothing here is prose-only by intent: each section ends in an
exit-code check (Beyoncé rule — a rule without an automated check does not exist).

**Verified against the code, not the appendix:** two appendix TO-CREATE items have since
landed on main and are **not** re-designed here:

- **Kernel as standalone plugin (M11/J1)** — `packages/kernel/` exists with README +
  `scripts/build-kernel-plugin.mjs`. Remaining work is playbook §T1 polish, not net-new design.
- **Bypass env out of agent reach (M15, half of the T1 target)** — the bypass env vars are
  already permission-denied in both the self settings (`.claude/settings.json:185-205`,
  `Bash(*ARBITER_GATE_BYPASS*)` etc., plus `Write/Edit(.arbiter/evidence/**)` and
  `gate-pass.json`) and the emitted template (`src/templates/claude/settings.json.ejs:125`).
  What remains of M15 is the **ceremony detector** (E4 below) — plus one real gap found while
  cross-checking: see E4 "legacy silent bypass".

Flip-coverage 100% (M11-PARTIAL) is an extension of the existing harness
(`scripts/check-guard-flip.mjs`), already scheduled in playbook §T3; it is referenced in the
wiring order but not re-designed.

---

## 0. Shared contract (every enforcer below obeys all of these)

| Rule                                            | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exit codes**                                  | INV-53: `0=PASS`, `1=FAIL`, `2=ERROR(self)`. No other codes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Catalog cohesion**                            | INV-94: every new `scripts/check-*.mjs` carries a `// CATALOG:` block (≥3 lines) naming the fold-in targets considered and rejected. Enforced by `check-script-cohesion.mjs` (`check-all.mjs:337`).                                                                                                                                                                                                                                                                                                                                                                                               |
| **Fail-closed**                                 | INV-96: uncertainty ⇒ FAIL, never SKIP. Internal errors ⇒ exit 2, visible. `check-fail-closed-audit.mjs` (`check-all.mjs:336`) scans `scripts/`, `.githooks/`, `.claude/hooks/` — new files are automatically in its scope.                                                                                                                                                                                                                                                                                                                                                                       |
| **Grading without editing the body (Sentinel)** | Enforcement level lives at the **wiring site**, never inside the check: (a) gate scripts graduate `runWarnCheck(...)` → `runCheck(...)` in `check-all.mjs` (one-line promotion; precedent `check-all.mjs:155`), or carry a `--enforce` flag flipped by the caller (precedent: `check-anti-proforma.mjs`, INV-118 "warn-default; `--enforce` promotes to hard-block"); (b) hooks declare hardness in `.arbiter/hooks-manifest.json` (`check-hardness-inventory.mjs:61` spawn-tests HARD entries against fixtures). Advisory→soft→hard = edit the manifest / the one wiring line, not the enforcer. |
| **Red-path proof**                              | M11: a check proven only green is ceremony. Every enforcer ships with a planted-bad + planted-clean fixture test in `__tests__/scripts/` (pattern: `check-hardness-inventory.test.ts`), and — once playbook §T3 lands — a flip-registry entry so `check-guard-flip.mjs`-style completeness covers it.                                                                                                                                                                                                                                                                                             |
| **Self ⊇ governed (CANON-14)**                  | Every self-side hook/check gets a twin under `src/templates/` emitted by `src/generators/claude.ts` (hooks; L2 list at `src/generators/claude.ts:142`) or `src/generators/check-all.ts` (gates, UNCONDITIONAL_EMISSIONS pattern per INV-134's precedent). `check-self-dogfood.mjs` fails on divergence — build both sides in the same PR.                                                                                                                                                                                                                                                         |
| **Hook bookkeeping**                            | New hooks need: a row in `docs/internal/SYSTEM/HOOK-CONTRACTS.md` (`check-hook-contracts.mjs` gate), a `.arbiter/hooks-manifest.json` entry (hardness gate), and a `.claude/CLAUDE.md` hooks-table row (`check-hook-doc-parity.mjs`, CANON-10).                                                                                                                                                                                                                                                                                                                                                   |
| **Invariant numbering**                         | Highest existing invariant is INV-136 (`src/invariants/catalog.ts`). New hard-tier enforcers claim INV-137+ (catalog + `GLOBAL_INVARIANTS.md`, parity-gated by `check-global-invariants-parity.mjs`); advisory-tier enforcers do NOT burn an INV until promoted.                                                                                                                                                                                                                                                                                                                                  |
| **No new public CLI commands**                  | Playbook §T2 caps the surface at ≤15 commands. Everything below is a script, a hook, a schema, or a skill edit — recorders are `node scripts/*.mjs`, reachable through the existing `Bash(node *)` allow (`.claude/settings.json:181`).                                                                                                                                                                                                                                                                                                                                                           |

---

## E1 — Agent-return envelope (M8 core + M12 citation enforcement)

**What.** One generic, schema-validated shape for everything a sub-agent hands back to the
orchestrator, replacing free prose for review/verify/skeptic returns. This is the substrate:
E2 (refutation) and M12 (citation-grounded claims) are fields and validators on this shape.

**Schema** — `schemas/agent-return.schema.json` (draft-07, same conventions as
`schemas/evidence-bundle.schema.json`: `required` + `additionalProperties:false`):

```json
{
  "schema": "arbiter-agent-return-v1",
  "agent": "red-team",
  "role": "skeptic | reviewer | scanner | verifier",
  "taskId": "#NNN",
  "branch": "...",
  "sha": "...",
  "ts": "ISO-8601",
  "verdict": "PASS | WARN | FAIL",
  "confidence": 0.0,
  "findings": [
    {
      "id": "stable-fingerprint",
      "severity": "critical|high|med|low|info",
      "kind": "structural|behavioral|process|style",
      "claim": "one sentence",
      "citations": [{ "file": "src/x.ts", "line": 42 }]
    }
  ],
  "refutations": [{ "target": "<finding id>", "verdict": "UPHELD|REFUTED", "citations": [] }],
  "evidenceRefs": [".arbiter/evidence/..."]
}
```

**M12 rule encoded in the schema + validator:** a finding with `kind:"structural"` MUST have
≥1 citation, and the validator resolves every citation — file exists at the envelope's `sha`
(`git cat-file -e <sha>:<file>`) and `line` ≤ file length. A structural claim without a
resolvable `file:line` is rejected at the tool layer, exactly as M12 TO-CREATE demands.

**Write path (tool layer).** Agents cannot write `.arbiter/evidence/**` directly — that path
is permission-denied (`.claude/settings.json:199-200`), which is correct and is preserved.
The orchestrator pipes the sub-agent's JSON through a recorder:
`node scripts/record-agent-return.mjs --task '#NNN' < return.json`, which (a) validates
against the schema **before** writing — a malformed return fails at hand-back time, not at
gate time; (b) stamps `branch`/`sha`/`ts` itself (never trusted from input, same authority
model as `gate-pass.json` written by `check-all.mjs:463-480`); (c) appends to
`.arbiter/evidence/agent-returns/<sanitized-task>/<agent>-<n>.json` (shard naming reuses
`sanitizeTaskId`, `.claude/hooks/lib.mjs:143`).

**Gate** — `scripts/check-agent-return.mjs`:

1. every file under `.arbiter/evidence/agent-returns/**` validates against the schema;
2. every structural citation resolves (as above);
3. cross-check with the dispatch sidecar: if `.arbiter/agents-dispatched.json`
   (written at `.claude/commands/ship.md:207`, consumed by `stop-evidence-guard.mjs:105`)
   records `count > 0` for the current branch and **zero** envelopes exist for the task —
   FAIL under `--enforce` (agents were dispatched but their returns evaporated into the
   context window; the R1 signature).

**Wiring (file:line).**

- `scripts/check-all.mjs` gate block, next to `evidence-bundle` (`:332`):
  `runWarnCheck('agent-return envelope', 'node', ['scripts/check-agent-return.mjs'])` —
  promotion = swap to `runCheck` + add `--enforce`.
- Producer side: `.claude/commands/ship.md` review/red-team phases and
  `.claude/skills/wave-drain/SKILL.md` Phase 2 gain one instruction line: "pipe each agent
  return through `record-agent-return.mjs`". Agent charters (`.claude/agents/red-team.md`,
  `context-checker.md`) get the output-shape contract appended.

**Red-path.** Fixtures in `__tests__/scripts/check-agent-return.test.ts`: (a) envelope with
`verdict:"MAYBE"` → 1; (b) structural finding citing `src/nope.ts:1` → 1; (c) synthetic
sidecar `count:3` + empty returns dir + `--enforce` → 1; (d) clean envelope → 0; recorder
rejects malformed stdin with exit 1 and writes nothing (fail-closed).

**Self / governed.** Schema + both scripts emitted (`src/templates/scripts/{check-agent-return,record-agent-return}.mjs.ejs`

- schema copy), wired into the generated `check-all.mjs` at L2+ via `src/generators/check-all.ts`;
  skill/command templates (`src/templates/claude/commands/ship.md.ejs`, agents `*.md.ejs`) carry
  the same producer lines. Self side materialized in the same PR (CANON-14).

**Tier.** Solo/L1: recorder available, gate not wired (methodology §3: solo keeps
tdd-evidence + gate-pass shapes only). Team/L2+: advisory gate wired. Gated-review/L4:
`runCheck` + `--enforce` (dispatch cross-check active). **Proposed INV-137** on promotion.

---

## E2 — Refutation-by-majority (M13)

**What.** High-stakes findings are not accepted from one agent: N independent skeptics are
dispatched with an explicit REFUTE mandate; a finding survives only with a strict majority of
UPHELD verdicts. Design goal: kill both R4 (false structural alarms — the "hexagonal
architecture is fiction" incident) and R2 (rubber stamps).

**Skill** — `.claude/skills/refutation/SKILL.md` (new): dispatch protocol. Inputs: a finding
set (E1 envelopes) + severity threshold (default ≥ `high`). For each finding: spawn N
read-only skeptics (registry ladder per `.claude/AGENT_REGISTRY.md`; rule-50 read-only clause
makes them legal in parallel without worktrees), each with (a) **only** the finding text +
its citations — no sibling verdicts, no orchestrator opinion (independence); (b) the mandate
"your job is to REFUTE this claim against the actual code; UPHELD only if you fail". Each
skeptic's return is an E1 envelope with `role:"skeptic"` + `refutations[]`. Majority rule:
`UPHELD > N/2` ⇒ finding survives; otherwise it is demoted to `info` and logged, never
silently dropped (M14 discipline).

**N is declared, not improvised (M1/M10 style):** a `refutation_skeptics` block is added to
`.claude/agent-dispatch-matrix.json` (the dispatch SSOT, jewel J2) —
`{"XS": 1, "S": 1, "Standard": 3}` — with the gated-review collaboration mode raising the
floor to the full vertical set (matrix `tier_verticals.Standard`, 7 verticals). The existing
parity gate `scripts/check-agent-dispatch.mjs` (`check-all.mjs:157`) extends by one assertion:
the skill's documented N table equals the matrix block (schema file
`.claude/agent-dispatch-matrix.schema.json` gains the property).

**Gate** — `scripts/check-refutation-verdicts.mjs`:

1. Trigger condition (fail-closed marker): when an audit/task declares adversarial mode, the
   skill writes `.arbiter/evidence/agent-returns/<task>/refutation-required.json`
   (threshold + N). Marker present ⇒ verdicts must exist; missing/short/tied verdicts ⇒ FAIL.
2. For every finding ≥ threshold that is **acted on** (referenced from the anchored plan —
   the plan file `readTaskState().plan` already exposed to hooks, `.claude/hooks/lib.mjs:260`):
   require ≥N skeptic envelopes targeting its `id` and a strict UPHELD majority.
3. No marker and no high-severity envelopes ⇒ PASS (nothing to adjudicate — not a skip:
   the scope condition is itself checked against the envelope severities).

**Wiring.** `check-all.mjs` gate block after the E1 line:
`runWarnCheck('refutation majority', ...)`; consumed hard inside destructive flows first:
wave-drain SKILL Phase 2 (red-team CRITICAL routing) and the playbook §7.5 pre-delete
contract cite the gate as a GO condition. Promotion path: `runCheck` at gated-review.

**Red-path.** Fixtures: 3 skeptic envelopes 1-UPHELD/2-REFUTED + plan referencing the finding
→ 1; 2-UPHELD/1-REFUTED → 0; marker present + 0 skeptic envelopes → 1; tie (2/2 of N=4) → 1
(strict majority). Matrix drift red-path: skill table says 3, matrix says 5 → parity gate 1.

**Self / governed.** Skill emitted via `src/generators/skills.ts` (+
`src/generators/skill-names.json`); gate script + matrix block emitted with the claude
generator family. Red-team agent template (`src/templates/claude/agents/*.md.ejs`) already
ships — the skill composes it rather than replacing it.

**Tier.** Solo: N=1 — the existing red-team **is** the skeptic; gate degrades to "red-team
envelope exists for CRITICAL findings". Team: N=3 majority. Gated-review: full vertical set,
`runCheck`. Fan-out never exceeds `min(--max-parallel, nproc-2)` (wave-drain cap).

---

## E3 — Dry-pass termination for discovery loops (M14)

**What.** Audits/drains of unknown size terminate on **evidence**, not fatigue: the loop may
conclude only after two consecutive passes with zero new findings, produced by
differently-seeded scans. Converts "I think we got everything" (a claim, R2) into a checkable
predicate.

**Ledger** — `.arbiter/evidence/audit/<audit-id>/pass-ledger.jsonl`, one line per pass:
`{ "pass": 3, "ts": "...", "sha": "...", "seed": "scope-shuffle-b", "scanners": ["dead-code","naming",...], "newFindings": 0, "totalFindings": 17 }`.
Written by the auditing skill at the end of each pass (findings deduped by the same
fingerprint discipline as the note spool, `src/commands/task-note.ts::FindingEntry` ~L61).

**Skill edit** — `.claude/skills/codebase-audit/SKILL.md` gains a **Termination** section
(after Constraints, `:83-86`): "Repeat passes until the last TWO ledger lines have
`newFindings: 0` **and** distinct `seed` values (re-partition scopes or shuffle scanner
assignment between them). Before writing the final report, run the gate below; a non-zero
exit means the audit is still wet — do not conclude." Same section is referenced from
wave-drain (its backlog-empty termination already satisfies M14 at backlog level; the ledger
adds the per-audit proof).

**Gate** — `scripts/check-audit-dry-pass.mjs [--dir <auditDir>] [--all]`:

1. A conclusion artifact (`report.md` / `concluded.json`) present while the ledger has <2
   passes, or the last two passes are not both `newFindings:0` → FAIL.
2. The two dry passes share the same `seed` → FAIL (same-seeded double-dry is one sample).
3. Malformed/unparseable ledger → FAIL (fail-closed, not skip). No audit dirs → PASS.

**Wiring.** (a) In-skill: the conclusion step of `codebase-audit` invokes the gate on its own
dir — the skill "refuses to conclude while the last pass was wet" becomes a mechanical
refusal. (b) `check-all.mjs` gate block: `runWarnCheck('audit dry-pass', 'node',
['scripts/check-audit-dry-pass.mjs', '--all'])` — catches concluded-but-wet audits committed
to evidence.

**Red-path.** Ledger `[..., {newFindings:2}]` + `report.md` → 1; two dry distinct-seed passes
→ 0; two dry same-seed → 1; truncated JSONL line → 1.

**Self / governed.** Skill + gate emitted (skills generator + check-all generator). The
evidence dir layout matches the existing `.arbiter/evidence/**` family so INV-90 retention
tooling (`scripts/evidence-rotate.mjs`) covers it for free.

**Tier.** All tiers keep the **rule** (two dry passes); solo may keep the ledger minimal
(counts only). Team+: ledger required (this gate wired). Gated-review: ledger part of the
audited evidence bundle (promotion to `runCheck`).

---

## E4 — Ceremony detector + bypass accounting closure (M15b)

**What.** The anti-deviance loop: (a) a gate bypassed more than N times/month is mechanically
flagged for demotion or deletion (a routinely-bypassed gate trains deviance — axiom 3;
observed: 305/332 bypasses on one gate); (b) an advisory gate with no dated promotion is
itself ceremony ("advisory-permanent"). Playbook §T4 names this exact target:
"`scripts/check-bypass-ceremony.mjs` + `doctor` reads it".

**Gate** — `scripts/check-bypass-ceremony.mjs`, two detectors in one script (same axis:
enforcement theater):

1. **Bypass-rate ceiling.** Parse `.arbiter/evidence/bypass-log.jsonl` (shape
   `{env, branch, ts, value, bypassed, reason}` — `scripts/lib/loud-bypass.mjs:25-32`) plus
   the pre-push shard the hook template appends
   (`src/templates/githooks/pre-push.ejs:78`). Aggregate `bypassed:true` per `env` over a
   trailing 30-day window; any channel over its ceiling → FAIL with the directive "demote
   the gate to advisory or delete it — a gate this bypassed is not a gate". Ceilings in
   `scripts/data/ceremony-thresholds.json` (default 12/month; per-env overrides; solo default 20) — data file, not `arbiter.json`, to avoid touching the required-config schema (T0/T2
   brick risk).
2. **Advisory-permanent detector.** Regex-scan `scripts/check-all.mjs` for `runWarnCheck(`
   call sites; each advisory name must have an entry in `scripts/data/advisory-ledger.json`:
   `{ "check": "...", "since": "YYYY-MM-DD", "promoteBy": "YYYY-MM-DD" }` or
   `{ ..., "permanent": true, "rationale": "..." }` (for genuinely informational surfaces,
   e.g. `conformance` `check-all.mjs:350`). Missing entry or `promoteBy` in the past → FAIL.
   This is the same dated-debt discipline as suppressions expiry (INV-31) applied to the
   gate roster itself.

**Doctor surface.** The script supports `--json`; `src/commands/doctor/health.ts`
(`runDoctorHealth`) gains one `HealthCheck` row "bypass budget" that shells the script and
renders channel counts + days-to-promotion — the standing T4 budget line.

**Closing the found gap — legacy silent bypass.** Cross-checking the code surfaced one
unlogged bypass channel: `.claude/hooks/pre-edit-plan-anchor.mjs:13` honors
`ARBITER_PLAN_BYPASS === '1'` with a bare `process.exit(0)` — **no** stderr line, **no**
JSONL append (the loud-bypass contract explicitly grandfathered `=1` legacy semantics,
`scripts/lib/loud-bypass.mjs:17-20`). Detector (1) can only count what is logged, so E4
includes the migration: legacy `=1` hook bypasses keep their user-facing semantics but gain
the JSONL append (hook-local, best-effort, never blocking — same defensive shape as
`appendJsonl`). Without this, the ceremony detector under-counts exactly the oldest, most
habitual channel. Same sweep covers the emitted hook twins (`pre-edit-plan-anchor.mjs.ejs`).

**Wiring.** `check-all.mjs` gate block (next to `commit-footer rationale (INV-119)`, `:333`):
`runWarnCheck('bypass ceremony', ...)` — and its own advisory-ledger entry with a `promoteBy`
date, so the detector polices itself. Promotion = `runCheck`.

**Red-path.** Synthetic log with 13 `bypassed:true` entries for one env inside 30 days → 1;
11 → 0; `runWarnCheck` name absent from ledger → 1; ledger entry `promoteBy` yesterday → 1;
`permanent:true` with rationale → 0. Migration red-path: run the patched hook with
`ARBITER_PLAN_BYPASS=1` in a fixture repo → bypass-log gains one line (assert), edit allowed.

**Self / governed.** Script + data files + doctor row are self-side; emitted twins for the
gate + thresholds default via check-all generator. Governed doctor parity rides the existing
`doctor` emission. Append-only property of the log is already protected agent-side by the
`.arbiter/evidence/**` write-deny (settings), and CI-side by INV-119 footer audit.

**Tier.** L2+ all modes; only the ceiling differs (solo 20/month). The advisory-ledger
detector is level-independent — ceremony is ceremony. **Proposed INV-138** on promotion.

---

## E5 — Spawn-time worktree guard (M9) + one-task-per-dispatch (M2)

**What.** Today M9 is an Iron Law with structural support (worktree engine, locks, rule-50)
but the **spawn itself is not intercepted**: nothing mechanically refuses to launch a second
write-agent into the main working tree. This hook is the missing PreToolUse tripwire for the
one failure mode with a confirmed real incident (R3, 2026-03-01). It also absorbs the M2
TO-CREATE (dispatch-manifest: an agent prompt references exactly one task).

**Hook** — `.claude/hooks/pre-spawn-worktree-guard.mjs`, PreToolUse, matcher `"Task|Agent"`
(the sub-agent dispatch tool; no matcher for it exists today —
`.claude/settings.json:3-44` covers only `Bash` and `Edit|Write`). Logic on stdin
`tool_input` (`{prompt, subagent_type, isolation?, ...}`):

1. **Classify write-intent.** `subagent_type` is looked up in
   `.claude/agents/agent-write-classes.json` (new, tiny: `{"codebase-scanner":"read-only",
"context-checker":"read-only", "red-team":"read-only", "bridge-reviewer":"read-only", ...}`
   — derived from the `tools:` frontmatter of `.claude/agents/*.md`, kept in parity by a
   3-line extension to `check-catalog-agents-parity.mjs`). Unknown type ⇒ **write-intent**
   (fail-closed). Read-only ⇒ exit 0 (the M7 firewall path stays frictionless).
2. **Write-intent path.** Allowed iff `isolation === "worktree"` **or** the prompt's declared
   cwd is under a worktree root (`<repo>.worktrees/` / `arbiter.worktrees/` — the layout
   `src/worktree/paths.ts` manages). Otherwise consult
   `.arbiter/agents-active.json` (new sidecar: `[{agent, ts, pid, cwd}]`, written by this
   hook on every allowed write-spawn): another live write-agent registered ⇒ **exit 2** with
   rule-50 recovery text ("second write-agent on the main tree — open a worktree:
   `/wt-open`, ADR-103"). No other writer ⇒ allow (serial main-tree work is legal) and
   register. Entries expire after 2h or on session Stop (a companion 5-line cleanup in the
   Stop chain) so a killed agent cannot wedge future spawns — staleness handling mirrors
   `arbiter worktree prune --stale`.
3. **One-task rule (M2).** Count distinct `#\d+` task ids in the prompt: >1 ⇒ advisory
   stderr at soft hardness, exit 2 at hard (grading via the hooks manifest — body unchanged).

**Wiring (file:line).**

- `.claude/settings.json` — new PreToolUse matcher block after `:43` (`"Task|Agent"` → the
  hook, timeout 5).
- Emitted twin: `src/templates/claude/settings.json.ejs` same block +
  `src/templates/claude/hooks/pre-spawn-worktree-guard.mjs.ejs`, registered in
  `src/generators/claude.ts` L2_ADVANCED_HOOKS (`:142`) — **exception:** emitted at ALL
  levels, because M9 never scales down (methodology §3); wire it beside the always-emitted
  raw hooks rather than the L2 list if level-gating would exclude L1.
- Bookkeeping: `.arbiter/hooks-manifest.json` entry (HARD, spawnable fixture),
  HOOK-CONTRACTS.md row, CLAUDE.md hooks table (all three gated — §0).

**Red-path** (hardness-inventory spawn fixtures + `__tests__`): stdin simulating dispatch of
an unknown agent type, no isolation, sidecar already holding one live writer → expect exit 2;
`codebase-scanner` dispatch under the same sidecar → 0; `isolation:"worktree"` write dispatch
→ 0 + sidecar grows; prompt containing `#12 and #34` at hard grading → 2.

**Self / governed.** Both, same PR (dogfood parity). The write-classes JSON is emitted next
to the agents the generators already ship (`src/templates/claude/agents/*.ejs`).

**Tier.** All tiers, all modes, HARD default for the parallel-second-writer branch — solo
runs the most unattended parallelism (methodology M9). The one-task rule starts soft
everywhere; promote per-repo via the manifest. **Proposed INV-139** (spawn-time isolation)
— the enforcement anchor ADR-103/rule-50 already provides the doctrine text.

---

## E6a — Handoff-lint (M1)

**What.** A handoff doc whose tasks carry no tier suggestion silently re-routes work to the
expensive model (R7); one without per-task `Verify:` commands is not executable by a cold
model (R1). Lint the contract the template already promises.

**Gate** — `scripts/check-handoff-doc.mjs [--file <path>]`. Scope: files matching
`**/HANDOFF*.md` plus any markdown whose H1 starts with `Handoff:` under `docs/` and
`.claude/plans/` (deterministic, no config). Per numbered task section (`### N.` — the shape
of `src/templates/HANDOFF.template.md:21-37`): require the five rows **What / Where / AC /
Verify / Suggested tier**; `Verify:` must contain a backtick command; `Suggested tier:`
must be non-empty and not the template placeholder (`…`/`_fill in_`). Template file itself is
exempt (it IS placeholders).

**Wiring.** `check-all.mjs` check block near the other doc gates (`doc style`, `:166`):
`runWarnCheck('handoff lint', ...)` → promote to `runCheck`. Producer side: the `/ship`
handoff phase and `context-rot-management` skill reference `--file` mode so a fresh handoff
is linted at write time, not at the next gate run.

**Red-path.** Fixture handoff with a task missing `Suggested tier:` → 1; `Verify:` with prose
and no backticks → 1; fully-formed → 0; template file untouched → 0.

**Self / governed.** Script emitted via check-all generator; the HANDOFF template it lints is
already emitted (`src/templates/HANDOFF.template.md`). Tier: all (M1 is a cost rule); solo
stays advisory.

---

## E6b — Finding-loss detector (M4)

**What.** The R1 signature at session scale: a session that dispatched research sub-agents
but persisted **nothing** — no notes, no envelopes, no evidence — lost its findings to the
context window. Distinct from the existing `reflectionSweep`
(`stop-evidence-guard.mjs:134-152`), which nudges to _drain_ findings already in the spool;
this detects that _zero were ever captured_.

**Hook** — `.claude/hooks/stop-finding-loss.mjs`, Stop event, registered after
`stop-evidence-guard` in the Stop chain (`.claude/settings.json:139-150`). Self-contained —
no new sidecar:

1. From the Stop payload's `transcript_path` (same parsing approach as
   `latestAssistantText`, `stop-evidence-guard.mjs:155-181`): count `tool_use` blocks whose
   tool is `Task`/`Agent` (research dispatches) and take the first line's `ts` as session
   start.
2. Count persistence events since session start: spool lines in `.arbiter/findings/*.jsonl`
   with `ts >= start` (shape `FindingEntry`, `src/commands/task-note.ts` ~L61) + files under
   `.arbiter/evidence/agent-returns/` with mtime ≥ start.
3. Dispatches ≥ 2 and persistence == 0 ⇒ advisory: stderr instruction ("N research agents
   returned; nothing was persisted — write `arbiter note` / record envelopes before
   stopping") with exit 0; at hard grading (hooks manifest) ⇒ exit 2, which re-prompts the
   model to persist (re-entry loop already guarded by `stop_hook_active`,
   `stop-evidence-guard.mjs:27` — same guard here).

**Red-path** (hardness fixtures): transcript with 3 Task dispatches + empty findings dir +
hard grading → 2; same at soft → 0 with stderr; transcript with dispatches + one in-window
spool line → 0 silent; unreadable transcript → 0 (stand down — same posture as
`stop-evidence-guard.mjs:47`, a guard that can't correlate must not block) with a
`FAIL-OPEN-INTENT` comment for the INV-96 auditor.

**Self / governed.** Hook + emitted twin (`.mjs.ejs`), Stop-chain registration in both
settings files, manifest/HOOK-CONTRACTS/CLAUDE.md rows. Tier: advisory at solo/team;
hard at gated-review for Standard-tier tasks (the M4 evidence-depth axis).

---

## E7 — Read-set advisory + touched⊆manifest (M6)

**What.** Context economy made checkable: plans declare what will be **read**, and what a
worker actually **touched** must stay inside its declared manifest. The write half already
carries parallel legality (ADR-103 disjointness); this reuses the same manifest to bound the
work, closing the M6 gap ("manifest exists for writes; read-set advisory missing").

**Plan-side (declaration).** Wave-drain Phase 1 manifest bullets
(`.claude/skills/wave-drain/SKILL.md:129-137`) gain one row: **Read-set** — files/globs the
group is expected to read beyond its write set. The HANDOFF template's `Where:` row
(`src/templates/HANDOFF.template.md:24`) doubles as the read-set for handoff-driven tasks
(no new field there — minimal surface).

**Gate** — `scripts/check-touched-vs-manifest.mjs --plan <plan.md> --group <G>
--base <ref> [--branch <b>]`: parse the group's `Files`+`Read-set` manifest rows; compute
`git diff --name-only <base>...<branch>`; any touched file outside the declared **write** set
⇒ FAIL (the hard, cheap, high-signal half — an agent that edited outside its manifest also
read outside it, and it voided the ADR-103 disjointness assumption). Missing manifest section
for a wave group ⇒ FAIL (declaration is the point). Read-set row absent ⇒ advisory line on
stderr, PASS (reads are bounded socially, writes mechanically).

**Wiring.** Wave-drain harvest phase: the skill runs the gate per group **before** merging
that group's branch (GO condition next to the group's gate-exec step); follow-up hard point
(separate PR): call it from `src/worktree/harvest.ts` so the engine, not the skill, refuses.
Optional L4-only hook `pre-read-readset-advisory.mjs` (PreToolUse `Read` matcher, stdout
advisory, always exit 0) exists in the design but is deliberately **not** in the default
wiring — per methodology §3 read-set is "manifest checked" only at enterprise, and a per-Read
hook is the kind of friction that breeds bypass culture (axiom 3).

**Red-path.** Synthetic repo: manifest declares `src/a.ts`; branch also edits `src/b.ts` → 1;
edits ⊆ manifest → 0; plan missing the group section → 1.

**Self / governed.** Script + skill-text emitted with the wave-drain family
(`src/generators/skills.ts`). Tier: solo — declaration advisory only (script available);
team — manifest per plan, gate at harvest advisory; gated-review — gate hard at harvest
(+ optional read hook).

---

## Wiring order (dependency-driven, matches methodology §5 recommendation)

1. **E1 envelope** — substrate; E2's refutations and M12's citation rule are fields on it.
   (schema + recorder + validator + producer lines; ~3 files + 2 templates)
2. **E2 refutation + E3 dry-pass** — one skill + one validator each, both consuming E1
   artifacts. Cheap; immediately harden the audit/deletion paths.
3. **E4 ceremony detector** (+ legacy loud-bypass migration + doctor row) — the immune
   system; also self-polices the advisory tier that steps 1–2 just created. Runs alongside
   playbook §T3 flip-coverage and §T4 dogfood closure.
4. **E5 spawn-time guard** — the only HARD-by-default hook here; needs the write-classes
   registry and Stop-chain cleanup, so it benefits from the bookkeeping patterns exercised
   in steps 1–3.
5. **E6a handoff-lint, E6b finding-loss, E7 read-set** — the advisory ring; each lands with
   its `advisory-ledger.json` entry carrying a real `promoteBy` date (E4 enforces that this
   ring cannot become advisory-permanent ceremony).

Every step ships: CATALOG marker, INV-53 codes, fail-closed posture (with explicit
`FAIL-OPEN-INTENT` comments where standing down is deliberate), planted bad+clean fixtures,
template twins for governed emission, and — for hooks — manifest/HOOK-CONTRACTS/CLAUDE.md
rows. The standard applies to its own enforcement.

## Out of scope (deliberately)

- Runtime model-tier selection/gating (M1): deprecated machinery, stays deprecated —
  enforcement remains on declarations (handoff-lint covers the declaration gap).
- A DSL or config framework for enforcer grading: grading is one wiring line or one manifest
  field by design (Sentinel), and that is the feature, not a limitation.
- Repointing `arbiter mark` skill references (M3-PARTIAL): a docs task tracked by playbook
  §T2.B, not an enforcer.
