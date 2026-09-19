---
title: 'Arbiter — C4 Model (Context / Container / Component)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-09'
owner: ''
canonical_id: 'C4-MODEL'
tags: ['audience/dev', 'kind/spine', 'kind/architecture']
related: ['docs/architecture/arc42.md', 'docs/internal/architecture/ARCHITECTURE.md']
---

# Arbiter — C4 Model

A [C4](https://c4model.com/) view of arbiter at three zoom levels. Diagrams are
[Mermaid](https://mermaid.js.org/) (text, versionable). Level 3 (Component) zooms into the
**orchestration engine** — the crown jewel of the system and the reason this document exists.

> Reading order: **Context** (who arbiter serves) → **Container** (its internal subsystems) →
> **Component** (how the orchestration engine decides when to challenge, review, verify, and
> cluster). For the narrative and the runtime flows, see [`arc42.md`](arc42.md) §3, §5, §6.

---

## Level 1 — System Context

Arbiter is a **local, zero-telemetry CLI**. It makes zero unsolicited network calls; the only
network egress is the developer's own `gh`/`git`/`npm` invocations. It has **no server and no
database** — all state is ordinary version-controlled files plus a local `.arbiter/` scratch dir.

```mermaid
graph TB
    dev["👤 Developer<br/>(runs npx @getarbiter/cli)"]
    agent["🤖 AI Coding Agent<br/>Claude Code / Codex<br/>(reads AGENTS.md, runs /ship)"]

    subgraph sys["Arbiter — AI-governance installer + optional orchestration layer"]
      arbiter["arbiter CLI<br/>(Node 22+ / TypeScript)"]
    end

    repo["📁 Target repository<br/>(the project being governed)"]
    gh["GitHub<br/>(issues, PRs, labels,<br/>branch protection, Actions)"]
    ci["CI runners<br/>(GitHub Actions:<br/>generated ci.yml / tier workflows)"]
    npm["npm registry<br/>(@getarbiter/cli distribution)"]
    tools["Stack toolchains<br/>(eslint · ruff · clippy · gofmt ·<br/>gradle · jscpd · trivy · gh)"]

    dev -->|"init · configure · ship · gold-audit"| arbiter
    agent -->|"drives /ship · /drain loop"| arbiter
    arbiter -->|"generates AGENTS.md, hooks,<br/>gates, CI, sub-agents (files only)"| repo
    arbiter -->|"reads/writes issues, PRs,<br/>labels (via gh CLI, ADR-003/020)"| gh
    arbiter -.->|"emits workflows that run on"| ci
    ci -->|"mirrors the local gate"| repo
    npm -->|"npx install"| arbiter
    arbiter -->|"invokes as gate steps"| tools
    agent -.->|"reads governance from"| repo

    classDef ext fill:#eef,stroke:#88a;
    class repo,gh,ci,npm,tools,dev,agent ext;
```

**Key context facts**

- **Two personas drive arbiter**: a human developer (occasional: `init`, `configure`,
  `gold-audit`) and an AI coding agent (continuous: the `/ship` and `/drain` loops). The agent is
  a first-class actor, not an afterthought — arbiter's contract is precisely that an agent
  "can't fake green".
- **Output is files, not a service.** Everything arbiter emits (`AGENTS.md`, `.claude/`,
  `scripts/check-all.mjs`, `.github/workflows/*`) is normal, version-controlled, deletable.
  Uninstall = `rm`.
- **`gh` is the only hard external dependency** for the GitHub-integration features (ADR-003);
  arbiter is CLI-first over MCP (ADR-020).
- **No telemetry, no network beacons** — enforced by `scripts/check-anti-telemetry.mjs` and a
  `telemetry-allowlist.json` suppression file.

---

## Level 2 — Container (subsystems inside arbiter)

Arbiter is a single Node process, but internally it is a set of cohesive subsystems. The
**installer core** (generation) and the **optional orchestration layer** (the `/ship`, `/drain`
engine) are distinct: the core is usable on its own; the orchestration layer sits on top.

```mermaid
graph TB
    cli["<b>CLI Front Controller</b><br/>src/cli.ts (commander)<br/>public via --help, full via help --all"]

    subgraph core["INSTALLER CORE (generation)"]
      wizard["<b>Wizard / Init</b><br/>src/wizard, src/commands/init<br/>interactive + non-interactive"]
      detect["<b>Detectors</b><br/>src/detectors<br/>language · framework · archetype"]
      profile["<b>Profile Resolver</b><br/>src/config (schema.ts,<br/>resolve-project-config.ts) ADR-094<br/>axes: level · archetype ·<br/>collab-mode · runner · contract"]
      gen["<b>Generators</b><br/>src/generators/*.ts<br/>render → writeFile per strategy"]
      tmpl["<b>Template Engine</b><br/>src/utils/render.ts (EJS)<br/>src/templates/**/*.ejs"]
      fs["<b>Write Pipeline</b><br/>src/utils/fs.ts<br/>backup · skipIfExists · deepMerge<br/>atomic tmp+rename"]
    end

    subgraph gov["GOVERNANCE MODEL (SSOT)"]
      inv["<b>Invariant Catalog</b><br/>src/invariants/catalog.ts<br/>INV-NN + selfOnly (ADR-059)"]
      kit["<b>KIT Catalog</b><br/>src/kit (catalog.json,<br/>taxonomy) ADR-045"]
      compat["<b>Compatibility Matrix</b><br/>src/compatibility<br/>language×archetype proven cells"]
    end

    subgraph verify["CHECK / VERIFY ENGINE"]
      conf["<b>Conformance Engine</b><br/>src/conformance (engine.ts,<br/>dimensions.ts) PASS/HALF/FAKE/FAIL"]
      gate["<b>Gate Runner</b><br/>scripts/check-all.mjs<br/>L1 ⊂ L2 ⊂ L3 ladder"]
      gold["<b>Gold Audit</b><br/>src/commands/gold-audit.ts<br/>scripts/gold-audit.mjs"]
      dog["<b>Self-Dogfood Check</b><br/>scripts/check-self-dogfood.mjs<br/>template↔materialized diff-pin"]
    end

    subgraph orch["ORCHESTRATION LAYER (optional) — the /ship, /drain engine"]
      ship["<b>Ship Engine</b><br/>src/commands/task-ship.ts<br/>next-action computer (ADR-088/093)"]
      state["<b>Task State Machine</b><br/>src/commands/task-state.ts<br/>8 phases, single-writer status.json"]
      vbridge["<b>Verification Bridge</b><br/>src/verify, verify-plan.ts<br/>rule engine → PASS/REJECT (ADR-039)"]
      fixred["<b>Fix-on-Red (policy)</b><br/>docs/REFERENCE/fix-on-red.md<br/>2-strike, fail-closed escalate — agent-reasoned"]
      gexec["<b>Gate Mutex</b><br/>src/commands/gate-exec.ts<br/>flock(1), keyed on git-common-dir"]
      wt["<b>Worktree Manager</b><br/>src/commands/worktree.ts<br/>src/worktree — isolation + harvest"]
    end

    subgraph audit["EVIDENCE & GRAPH"]
      ev["<b>Evidence Store</b><br/>src/evidence, .arbiter/evidence<br/>TDD · final review · acceptance · gate"]
      graph["<b>Provenance Graph</b><br/>src/graph (ADR-040)<br/>enforces/proves edges"]
      plugin["<b>Plugin API</b><br/>src/types/plugin.ts, src/utils/plugin-loader.ts<br/>config-driven, no CLI subcommand (ADR-031/048)"]
    end

    cli --> wizard & ship & conf & gold & plugin
    wizard --> detect --> profile --> gen
    gen --> tmpl --> fs
    gen -.reads.-> inv & kit & compat
    ship --> state
    ship --> vbridge
    ship --> fixred
    ship --> wt
    wt --> gexec
    ship -.writes.-> ev
    vbridge -.reads/writes.-> ev
    conf -.reads.-> inv & kit
    gate --> conf
    gold --> conf
    dog -.diffs.-> tmpl
    graph -.feeds.-> vbridge

    classDef jewel fill:#fdf3d7,stroke:#c99700,stroke-width:2px;
    class ship,state,vbridge,fixred,gexec,wt jewel;
```

**Container responsibilities (one line each)**

| Container            | Responsibility                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| CLI Front Controller | `commander` command surface; routes to command handlers; registers hidden/experimental commands              |
| Wizard / Init        | Interactive + flag-driven project bootstrap; produces a `ProjectConfig`                                      |
| Detectors            | Auto-detect language, framework/build tool, archetype from repo signals                                      |
| Profile Resolver     | Resolve one `ProjectProfile` from config across 5 orthogonal axes; single precedence layer (ADR-094)         |
| Generators           | Renders its templates and writes with the correct conflict strategy (count: `.bloat-baseline.json`)          |
| Template Engine      | EJS render; `governanceLevel` guards; static files copied verbatim (count: `.bloat-baseline.json`)           |
| Write Pipeline       | `backup` / `skipIfExists` / deep-merge strategies; atomic tmp+rename; SIG cleanup                            |
| Invariant Catalog    | Machine-readable INV-NN rules; `selfOnly` filters arbiter-internal rules from generated output               |
| KIT Catalog          | Dimension taxonomy (wrap-not-replace); links dims → invariants → validators                                  |
| Compatibility Matrix | `language × archetype` "proven" cells; every proven cell must be gated + fixtured (CANON-02/03)              |
| Conformance Engine   | Evaluate dimensions → `PASS / HALF / FAKE / FAIL` verdicts (ADR-083)                                         |
| Gate Runner          | `check-all.mjs` orchestrates the L1⊂L2⊂L3 check ladder                                                       |
| Gold Audit           | Score arbiter's own governance completeness (D-* dimensions) against a ratcheted baseline                    |
| Self-Dogfood Check   | Fail-closed diff between shipped templates and arbiter's materialized `.claude/`                             |
| Ship Engine          | Deterministic next-action computer; phase→step; advance-on-green                                             |
| Task State Machine   | 8-phase result-first lifecycle; single-writer `status.json`; durable cursor and treatment                    |
| Verification Bridge  | Claim-verified gates for TDD, final review, per-AC acceptance, exact-subject gate and landing                |
| Fix-on-Red           | Failure-signature 2-strike policy, agent-reasoned since T2 (no CLI engine); fail-closed `escalate-uncertain` |
| Gate Mutex           | `flock(1)` serialization of expensive gates across parallel worktrees of one repo                            |
| Worktree Manager     | Per-agent isolated worktrees; per-worktree caches; merge-guarded harvest                                     |
| Evidence Store       | Append-only TDD / final-review / acceptance-fit / gate / companion artifacts under `.arbiter/`               |
| Provenance Graph     | First-class `enforces` / `proves` edges linking invariants ↔ gates ↔ tests                                   |
| Plugin API           | Config-driven third-party rule plugins (`arbiter.json` `plugins[]`); no CLI subcommand (v1.1)                |

---

## Level 3 — Component: the Orchestration Engine (the jewel)

This is the heart of the system: **how arbiter decides when to challenge, how many reviewers to
dispatch, which review verticals fire, and how completion is gated on correlated evidence.**

The design principle is a **two-layer split**: arbiter's TypeScript engine is a _deterministic
next-action computer_ that **cannot write code or dispatch review sub-agents**; the generated
`/ship` slash command is the _model-driven driver loop_ that executes the model-requiring steps
between engine calls (`task-ship.ts:3-10`).

```mermaid
graph TB
    subgraph driver["DRIVER LOOP (model side) — generated /ship command"]
      loop["ship.md.ejs loop:<br/>1. arbiter ship #N → get step<br/>2. do the model-work<br/>3. arbiter ship #N --advance"]
      rev["Independent final reviewer panel<br/>(persisted pertinent verticals)"]
    end

    subgraph engine["NEXT-ACTION COMPUTER (deterministic, TS engine)"]
      seed["seedShipState<br/>normalize #NNN, seed status.json"]
      tierR["<b>Treatment Resolver</b><br/>complete evidence → XS/S/Standard<br/>missing evidence → Standard"]
      step["<b>shipStepFor(phase,tier,profile)</b><br/>→ ShipStep{action, reviewAgents,<br/>verticals, command}"]
      adv["advanceShipPhase<br/>runTaskAdvance → phase gate<br/>throws if RED (never advances)"]
      counts["<b>Persisted ShipTreatment</b><br/>plan depth · reviewers · verticals<br/>acceptance fit · model capability"]
    end

    subgraph route["DISPATCH PROJECTION + ROUTING"]
      matrix[".claude/agent-dispatch-matrix.json<br/>projection and test oracle<br/><b>not runtime policy</b>"]
      audr[".claude/auditor-routing.json<br/>7 weighted auditors<br/>always_on: bugs,type-safety,domain<br/>tag_map: glob → auditors"]
    end

    subgraph gates["FAIL-CLOSED VERIFICATION GATES"]
      pg["Mechanical plan admission<br/>acceptance · non-goals · files · proof"]
      tg["TDD-evidence gate<br/>sha-on-branch + re-executed at test_commit_sha (#1957)<br/>(task.ts:450-490, verify-tdd.ts)"]
      sg["stop-evidence-guard (INV-114)<br/>final-review sidecar + exact-subject gate"]
      cap["Review completion<br/>blocking findings + per-AC acceptance fit"]
    end

    loop --> seed --> tierR --> step
    step --> counts
    step -->|"refactor phase"| rev
    rev -.routed by.-> audr
    matrix -.tests parity.-> counts
    rev --> cap
    cap --> sg
    loop -->|"--advance"| adv
    adv --> pg & tg
    pg & tg & sg -->|"all green"| complete["✅ phase: complete<br/>guard released → merge"]

    classDef jewel fill:#fdf3d7,stroke:#c99700,stroke-width:2px;
    class tierR,step,matrix,audr,sg,cap jewel;
```

### The dynamic rules, precisely (with sources)

**1. The resolver is the only runtime policy.** `resolveShipTreatment` consumes the requested tier,
complete file/caller evidence, graph blast radius, labels and sensitive paths. It may widen but
never narrow. Incomplete narrow-tier evidence resolves to Standard, and the persisted treatment is
trusted by later read-only calls.

**2. Review is result-first.** XS, S and ordinary Standard work use one pertinent independent final
reviewer. Sensitive auth, money, concurrency, migration, data-integrity or deployment work may add
specialists, capped at three. The same panel returns acceptance fit for every frozen AC.

**3. The matrix is a projection and test oracle.** `agent-dispatch-matrix.json` is compared against
the compiled resolver by `check-agent-dispatch.mjs`; it is not read to make a second runtime tier
decision. `route-auditors.mjs` calls the resolver and unions in file-path specialists.

**4. Completion is fail-closed (INV-114).** `.arbiter/agents-dispatched.json` must prove the exact
persisted reviewer panel, acceptance-fit evidence must cover every criterion, and
`.arbiter/gate-pass.json` must bind the exact source tree, branch, task, checkout, toolchain, level
and TTL. Source changes invalidate dependent evidence.

**5. Checkpoint and delivery obligations differ.** Local TDD commits retain staged secret scanning,
staged-file economy checks and RED integrity. Targeted checks run during implementation; one full
L1 qualifies the frozen candidate, and L2 qualifies it before push. Security, privacy, coverage and
debt-ratchet thresholds remain unchanged.

For the batch/wave sibling of this loop (`/drain`, issue clustering, worktree pool, gate mutex),
see [`arc42.md`](arc42.md) §6.3 (Runtime View — Wave Drain).
