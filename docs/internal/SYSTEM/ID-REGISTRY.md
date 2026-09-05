---
title: 'ID Registry — every identifier scheme, and the mechanism that keeps it honest'
doc_version: '1.0.0'
status: active
last_review: '2026-09-02'
owner: ''
canonical_id: 'id-registry'
tags: ['audience/dev', 'kind/reference']
related:
  [
    'docs/internal/SYSTEM/OD-REGISTRY.md',
    'docs/internal/SYSTEM/CANON.md',
    'schemas/id-registry.schema.json',
  ]
---

# ID Registry

The registry of registries. Every identifier scheme that appears as a **citation** in an arbiter
artifact is declared here with the file that owns its instances, the gate that validates them, the
CLI surface that reads them, and the agent-edit hook that catches a violation before CI does.

Two mechanisms consume this file, and nothing else may:

- `scripts/check-id-registry.mjs` — the block below parses and validates against
  `schemas/id-registry.schema.json`; no two schemes may share a prefix or own overlapping
  patterns; every declared `ssot` path resolves on disk; every `staged` entry carries a future
  `expires`; every cited `OD-NN` resolves to a row in the OD registry.
- `scripts/check-ontology-wired.mjs` — the anti-prose meta-gate: for every row, the `gate` script
  exists and is registered on the side its `track` names (`self` ⇒ `scripts/check-all.mjs`,
  `target` ⇒ `src/templates/scripts/check-all.mjs.ejs`), the `tool` verb resolves in `src/cli.ts`,
  and the `hook` path exists and is registered in `.claude/settings.json`. Anything unmapped fails,
  named, against the ratchet in `scripts/data/ontology-baseline.json`.

**Scope.** Citation-shaped identifiers only. Level and tier vocabularies (`L1`–`L4` governance,
`L0`–`L3` autonomy, `XS`/`S`/`Standard` ship tiers, track letters `A`–`D`) are enum values inside a
typed config, not citations, and are owned by `src/config/schema.ts`.

**`n/a` is never blank.** A `gate`, `tool` or `hook` of `n/a` requires a `note` giving the reason —
an unreasoned `n/a` is a blanket exemption and the gate rejects it.

**`staged` is a dated obligation, not a wish.** A staged row names the wave that wires it and fails
the gate once `expires` passes, the same dated-debt discipline as `scripts/canon01-self-only.json`
and INV-31.

<!-- ID_REGISTRY_START -->

```json
{
  "registryVersion": "1.0.0",
  "schemes": [
    {
      "prefix": "INV",
      "pattern": "^INV-[0-9]{2,3}$",
      "meaning": "A mechanically enforced invariant of the framework.",
      "ssot": "src/invariants/catalog.ts",
      "gate": "scripts/check-inv-enforcement-wired.mjs",
      "track": "self",
      "tool": "arbiter validate",
      "hook": "n/a",
      "status": "active",
      "graphNode": "INV",
      "note": "No single edit-time hook: an invariant is enforced by the gate its `enforcement` field names, and INV-52 already fails when that script is not wired into check-all.mjs."
    },
    {
      "prefix": "PROJ",
      "pattern": "^PROJ-[0-9]{2,3}$",
      "meaning": "A project-declared invariant living in the consumer's arbiter.json.",
      "ssot": "src/config/schema.ts",
      "gate": "n/a",
      "track": "target",
      "tool": "arbiter validate",
      "hook": "n/a",
      "status": "active",
      "note": "Shape is enforced by the arbiter.json config schema (ADR-112) rather than a standalone script; `arbiter validate` is the surface that runs it, and the SSOT column names the schema that defines the field."
    },
    {
      "prefix": "CANON",
      "pattern": "^CANON-[0-9]{2}$",
      "meaning": "A process-level canon rule derived from an audit wave.",
      "ssot": "docs/internal/SYSTEM/CANON.md",
      "gate": "scripts/check-canon-enforcement-parity.mjs",
      "track": "self",
      "tool": "n/a",
      "hook": "n/a",
      "status": "active",
      "note": "Corrected 2026-09-02: this row first shipped as `staged` on the claim that CANON was unparsed prose. It is not. check-canon-enforcement-parity.mjs (B1) parses every `## CANON-NN` entry and requires its Enforcement field to either cite a gate/hook/test that exists AND is wired, or declare a dated promotion that has not expired — prose with neither fails. It currently reports 23 entries, 23 gated. No CLI verb reads CANON, and no edit-time hook: the parity the gate checks is whole-file (entry vs the wiring of the script it names), which a per-edit check cannot decide."
    },
    {
      "prefix": "ADR",
      "pattern": "^ADR-[0-9]{3}$",
      "meaning": "An architecture decision record.",
      "ssot": "docs/internal/ADR",
      "gate": "scripts/check-adr-index.mjs",
      "track": "self",
      "tool": "arbiter graph build",
      "hook": "n/a",
      "status": "active",
      "graphNode": "ADR",
      "note": "Two gates, one scheme: check-adr-index.mjs owns structure (canonical_id, index parity) and check-adr-enforcement.mjs owns the `enforces:` linkage — every declared ref must resolve to a real gold-check or invariant. That linkage was OPT-IN, so 115 of 118 numbered ADRs named nothing keeping them true; #2480 added a coverage ratchet (scripts/data/adr-enforcement-baseline.json) that pins the count so a NEW decision must declare its enforcement while the corpus is paid down. No separate check-adr-confirmation.mjs was written: a second gate for the same field would have duplicated the one that already resolves it (CANON-16)."
    },
    {
      "prefix": "D",
      "pattern": "^D-[0-9]{2}$",
      "meaning": "A blocked project decision awaiting an owner, in a governed project's registry.",
      "ssot": "src/templates/docs/skeletons/decision-registry.md.ejs",
      "gate": "scripts/check-decision-registry.mjs",
      "track": "target",
      "tool": "arbiter doc-set",
      "hook": "n/a",
      "status": "active",
      "note": "A target-project scheme (ADR-113): arbiter owns the template and the gate, the consumer owns the instances, so the gate is wired in the generated check-all rather than arbiter's own."
    },
    {
      "prefix": "REQ",
      "pattern": "^REQ-[0-9]{3}$",
      "meaning": "A requirement row in the requirements-traceability matrix.",
      "ssot": "docs/internal/PRODUCT/FEATURE_MATRIX.md",
      "gate": "scripts/check-feature-matrix.mjs",
      "track": "both",
      "tool": "arbiter graph build",
      "hook": "n/a",
      "status": "active",
      "graphNode": "REQ",
      "note": "No edit-time hook: a matrix row's status ladder is fail-closed on refs that must resolve on disk, which is a whole-file property the gate computes — a per-edit check would pass on a row the next edit invalidates."
    },
    {
      "prefix": "AC",
      "pattern": "^AC-[0-9]+$",
      "meaning": "An acceptance criterion, frozen from the issue into the plan and verdicted per task.",
      "ssot": "src/commands/task-state.ts",
      "gate": "scripts/check-acceptance.mjs",
      "track": "self",
      "tool": "arbiter task get",
      "hook": "n/a",
      "status": "active",
      "note": "Issue-scoped rather than globally numbered: AC-1 means something different under each task id, which is why the pattern carries no width. The SSOT is the module owning the shape, not the runtime .claude/.task/status.json it writes — that file is per-checkout state and absent on a fresh clone."
    },
    {
      "prefix": "#",
      "pattern": "^#[0-9]+$",
      "meaning": "A GitHub issue or pull request.",
      "ssot": "github",
      "gate": "n/a",
      "track": "self",
      "tool": "arbiter task get",
      "hook": "n/a",
      "status": "active",
      "note": "GitHub owns the instances; arbiter validates only the citation shape, which the plan and evidence schemas already pin to ^#[0-9]+$."
    },
    {
      "prefix": "N",
      "pattern": "^N[0-9]{2}$",
      "meaning": "A KIT dimension: one measurable capability of the governance kit.",
      "ssot": "src/kit/catalog.json",
      "gate": "scripts/check-kit-catalog-parity.mjs",
      "track": "self",
      "tool": "n/a",
      "hook": "n/a",
      "status": "active",
      "note": "No CLI verb reads KIT dimensions directly; they are consumed by scripts/build-kit.mjs and joined onto RTM rows by the feature-matrix gate."
    },
    {
      "prefix": "GA",
      "pattern": "^GA-[A-Z]+-[0-9]{2}$",
      "meaning": "A gold-audit check.",
      "ssot": "standards/gold-registry.yml",
      "gate": "scripts/gold-audit.mjs",
      "track": "both",
      "tool": "arbiter gold-audit",
      "hook": "n/a",
      "status": "active",
      "note": "No edit-time hook: a gold-audit check's verdict is computed from the repository as a whole by the audit engine, so there is no single edited file whose validity a hook could decide."
    },
    {
      "prefix": "RT",
      "pattern": "^RT-[0-9]{2}$",
      "meaning": "A red-team finding carried forward into code review.",
      "ssot": "src/commands/task-state.ts",
      "gate": "n/a",
      "track": "self",
      "tool": "arbiter task get",
      "hook": "n/a",
      "status": "active",
      "note": "Findings live in the typed UnifiedTaskState written by src/commands/task-state.ts, whose shape is enforced at write time rather than by a separate script; the runtime .claude/.task/status.json is per-checkout state, not a tracked SSOT."
    },
    {
      "prefix": "OD",
      "pattern": "^OD-[0-9]{2}$",
      "meaning": "An owner decision: a judgement call only the project owner can make.",
      "ssot": "docs/internal/SYSTEM/OD-REGISTRY.md",
      "gate": "scripts/check-id-registry.mjs",
      "track": "self",
      "tool": "n/a",
      "hook": "n/a",
      "status": "active",
      "note": "Was the blandest scheme in the repo: cited in hooks, tests and the advisory ledger with no registry defining it. The gate now resolves every OD-NN citation against the registry, so an invented decision id fails."
    },
    {
      "prefix": "M",
      "pattern": "^M[0-9]{1,2}$",
      "meaning": "An agent-orchestration methodology measure.",
      "ssot": "docs/methodology/agent-orchestration-and-context-hygiene.md",
      "gate": "scripts/check-methodology-coverage.mjs",
      "track": "self",
      "tool": "arbiter method",
      "hook": "n/a",
      "status": "active",
      "note": "The prefix is assigned to the methodology measures, and MS-NN (below) claims the milestone scheme so a NEW bare M13 can only mean adversarial refutation. The migration is not retroactive and this row does not pretend otherwise: docs/internal/PRODUCT/MILESTONES.md still carries 33 historical `## MN` headings, which wave 3 supersedes when MILESTONES.yml becomes the milestone SSOT and the prose file becomes a record. Four ADR titles keep their historical `(M19)`/`(M20)`/`(M21)`/`(M24)` suffix deliberately — a title records what a decision was called, and rewriting it would falsify the record."
    },
    {
      "prefix": "E",
      "pattern": "^E[0-9]{1,2}[a-z]?$",
      "meaning": "An anti-context-rot enforcer.",
      "ssot": "docs/design/anti-context-rot-enforcers.md",
      "gate": "scripts/check-anti-fake-green.mjs",
      "track": "self",
      "tool": "n/a",
      "hook": "n/a",
      "status": "active",
      "note": "Corrected 2026-09-02: this row first shipped as `staged`, claiming a collision with standards/gold-registry.yml and no gate. Both claims were wrong. The gold-registry keys its checks GA-ENF-NN and its D-ENFORCEMENT dimension only NAMES E1-E7 in a title and a comment, referring to these same enforcers — a cross-reference, not a second scheme. And the enforcers are gated: scripts/lib/anti-fake-green-guards.mjs enumerates them as class `context-rot` with a mandatory red-path flip proof in scripts/lib/guard-flip-registry.mjs, adjudicated by scripts/check-anti-fake-green.mjs. No CLI verb and no edit-time hook: an enforcer is a gate, and what needs proving is that it goes red on a bad input — a whole-repo property."
    },
    {
      "prefix": "ARC",
      "pattern": "^ARC-[0-9]{2}$",
      "meaning": "One of the twelve arc42 slots of a project's architecture document.",
      "ssot": "docs/architecture/arc42.md",
      "gate": "scripts/check-arc42-slots.mjs",
      "track": "both",
      "tool": "arbiter doc-set",
      "hook": "n/a",
      "status": "active",
      "note": "NOT the bare `A` prefix the programme plan proposed: `A2`, `A4` and `A11` are already in use as audit-wave and action-plan ids (docs/internal/DEVELOPMENT/REAL-PROJECT-TESTING.md, docs/internal/ADR/037-evidence-harness-target-projects.md, .claude/rules/95-closer-mode.md), so `A` would have collided on the day it was registered — this registry catching its own plan is the mechanism working. A fixed enumeration rather than minted ids, like CANON: the twelve slots are arc42's, and a project neither invents nor retires one. The pattern is deliberately the loose `[0-9]{2}` shared by every other scheme rather than an exact 01-12 alternation: this registry's job is collision detection, which needs a pattern the gate can expand into a sample, and check-arc42-slots.mjs is what enumerates the real twelve. `hook: n/a` — the artifact is prose under a heading, not a schema'd document, so there is nothing for post-edit-artifact-schema.mjs to validate at edit time; the gate is the enforcement."
    },
    {
      "prefix": "MS",
      "pattern": "^MS-[0-9]{2}$",
      "meaning": "A product milestone with a GSN goal, exit criteria and dependencies.",
      "ssot": "docs/internal/PRODUCT/MILESTONES.yml",
      "gate": "scripts/check-milestones.mjs",
      "track": "both",
      "tool": "arbiter graph build",
      "hook": ".claude/hooks/post-edit-artifact-schema.mjs",
      "status": "staged",
      "expires": "2026-11-15",
      "graphNode": "MILESTONE",
      "note": "Wave 3. Claims the prefix now so no NEW milestone is numbered into the methodology namespace; the SSOT file, the gate and the MILESTONE node land together, and the 33 historical MN headings in MILESTONES.md are superseded rather than renamed in place."
    },
    {
      "prefix": "SRC",
      "pattern": "^SRC-[0-9]{3}$",
      "meaning": "An external source whose application to the architecture is certified, not merely cited.",
      "ssot": "docs/internal/PRODUCT/SOURCES.md",
      "gate": "scripts/check-sources.mjs",
      "track": "both",
      "tool": "arbiter sources",
      "hook": ".claude/hooks/guard-sota-required.mjs",
      "status": "staged",
      "expires": "2026-12-15",
      "graphNode": "SOURCE",
      "note": "Wave 5. The gate is deterministic first: a quoted span must be a literal substring of the committed excerpt whose hash matches, before any judgement about relevance is asked of a model. Wave 7 made `track: both` real for the gate half: src/templates/scripts/check-sources.mjs.ejs ships with schemas/source-record.schema.json beside it and a row in the emitted gate registry, reading docs/SOURCES.md where arbiter reads its own internal path. The row stays `staged` because the tool and hook columns are still promises — `arbiter sources` and guard-sota-required.mjs land with tiers 2 and 3, and the dated expiry is what keeps that from becoming permanent."
    },
    {
      "prefix": "UC",
      "pattern": "^UC-[0-9]{2}$",
      "meaning": "A structured use case with an actor, a goal and the tests that prove it.",
      "ssot": "schemas/use-case.schema.json",
      "gate": "scripts/check-use-cases.mjs",
      "track": "both",
      "tool": "n/a",
      "hook": "n/a",
      "status": "active",
      "graphNode": "USECASE",
      "note": "Wave 8 (INV-149). The `ssot` names the SCHEMA rather than an instance file, on the PROJ row's precedent: instances live in a governed project (docs/USE_CASES.md), so no path in arbiter's tree holds them, and the column names the contract that defines them instead. The note this row carried was written from a survey and two thirds of it was wrong: arbiter has no prose use-case matrix and its only Gherkin features are stack fixtures, so there were never three near-misses to unify here — the third, the tabletop catalogue, is now gated in its own right as TT and is JOINED to this scheme rather than absorbed by it. What the gate actually does is resolve every featureId into the feature matrix, because a use-case matrix decays by rename and a dangling featureId reads exactly like coverage. The work happens on the TARGET track and the asymmetry is structural: arbiter's 62 matrix rows are cross-cutting capability areas, so one of its use cases would name nearly all of them and the link would carry no information; a product's use case names one or two features, and that ratio is what makes the edge worth checking. The self copy therefore SKIPs out loud, and the emitted twin is proven to RUN in a project-shaped tree rather than proven to render. `tool: n/a` because no CLI verb reads use cases — `arbiter graph build` was claimed here before the USECASE node existed, and naming a surface that does not read this artifact is the phantom-command class of claim this registry refuses. `hook: n/a` because post-edit-artifact-schema.mjs validates a document against a JSON Schema and its dispatch table does not cover this path on either track; wave 8 taught the meta-gate to check that, so the claim cannot be made without being true."
    },
    {
      "prefix": "TT",
      "pattern": "^TT-[0-9]{2}$",
      "meaning": "A tabletop scenario definition, exercised against a use case or runbook.",
      "ssot": "docs/internal/METHOD/TABLETOP-SCENARIOS.md",
      "gate": "scripts/check-tabletop-evidence.mjs",
      "track": "both",
      "tool": "n/a",
      "hook": "n/a",
      "status": "active",
      "graphNode": "SCENARIO",
      "note": "Wave 8 wired the definitions half: the gate reads docs/internal/METHOD/TABLETOP-SCENARIOS.md directly for field presence, TT id and slug uniqueness, and — the rule that could not exist while the definitions were prose — the JOIN, so an evidence file naming a scenario nothing declares fails. The id and the slug coexist on the ADR precedent: the id is the stable citation key, the slug is what the evidence filename <slug>-<date>.md is built from. `tool: n/a` because no CLI verb reads scenarios; the gate and the /tabletop skill are the only consumers, and inventing a verb to fill this column would be the ceremony this registry exists to refuse. `hook: n/a` because post-edit-artifact-schema.mjs validates a JSON or YAML document against a JSON Schema and this catalogue is prose with a bespoke parser — there is no document to hand it. This row claimed that hook until wave 8, when the meta-gate learned to check whether a named hook COVERS the row's SSOT and found that it never could."
    },
    {
      "prefix": "RB",
      "pattern": "^RB-[0-9]{2}$",
      "meaning": "A runbook that handles the violation of a named operational invariant.",
      "ssot": "docs",
      "gate": "scripts/check-runbook-coverage.mjs",
      "track": "self",
      "tool": "arbiter doc-set",
      "hook": "n/a",
      "status": "staged",
      "expires": "2027-01-31",
      "graphNode": "RUNBOOK",
      "note": "Wave 8 built the gate (INV-148). Two corrections this row needed, both found by building it rather than by re-reading it: the ssot was `docs/internal/runbooks`, but only one of the two runbooks lives there — CODEX_PARITY_RUNBOOK.md sits under docs/internal/METHOD — so the SSOT is the doc tree and membership is declared by the `kind/runbook` tag, not by a directory; and the track was `both`, which was aspiration, since no Track-B template exists. Coverage is the same algebra as requirement-to-test but the two halves are NOT symmetric in strength: a runbook handling no invariant, or naming one that does not exist, is a hard failure, while operational invariants with no runbook are a ratcheted debt counter (49 of 49 today) — a hard rule there would be red on arrival and baselined into meaninglessness. Stays staged until the Track-B emission lands."
    },
    {
      "prefix": "FS",
      "pattern": "^FS-[0-9]{2}$",
      "meaning": "A feasibility study that informs a decision.",
      "ssot": "docs/architecture/feasibility.md",
      "gate": "scripts/check-doc-set.mjs",
      "track": "both",
      "tool": "arbiter doc-set",
      "hook": "n/a",
      "status": "staged",
      "expires": "2027-01-31",
      "note": "The doc-set row landed in wave 2, on BOTH tracks: standards/gold-doc-set.yml and src/templates/standards/gold-doc-set.yml.ejs, so presence and freshness are gated for arbiter and for every governed project. Still staged for wave 8, which owes the FS-NN identifier itself — frontmatter carrying the id and its `informs` edges — without which the study is a gated document but not yet an addressable node. The contract rides the doc-set engine rather than earning a script of its own."
    },
    {
      "prefix": "EP",
      "pattern": "^EP-[0-9]{2}$",
      "meaning": "An epic: a decomposable unit of work targeting a milestone.",
      "ssot": "docs/internal/PRODUCT/MILESTONES.yml",
      "gate": "scripts/check-milestones.mjs",
      "track": "both",
      "tool": "arbiter graph build",
      "hook": ".claude/hooks/post-edit-artifact-schema.mjs",
      "status": "staged",
      "expires": "2027-01-31",
      "graphNode": "EPIC",
      "note": "Wave 8. Shares the milestone SSOT and gate deliberately: an epic that targets no milestone is the defect the join exists to surface, and the gate checks it in BOTH directions. `status` is a claim the gate cannot verify against GitHub — it is offline by contract (INV-13) — so a terminal status is held to the same fail-closed evidence_ref rule the milestone statuses carry. The ladder gained an `abandoned` rung from the data: all three epics recorded here were already closed, two of them not-planned, while the SSOT prose called them open. STILL STAGED, and precisely because the meta-gate says so: the contract, the gate rules and the edit-time hook coverage are all live on arbiter's own track, but check-milestones.mjs has no Track-B template, so a governed project runs none of it. That debt is MS-NN's and EP-NN's jointly — one emission clears both rows — and neither may go active before it lands."
    }
  ]
}
```

<!-- ID_REGISTRY_END -->
