---
name: tabletop
description: Use when the user wants a use case walked end to end the way a user lives it — narrate the journey as the persona, execute every read-only or dry-run step, compare what the docs promise against what actually happens, and record the disagreements as owned findings. Evidence only; never changes the repo.
title: 'Tabletop (use-case exercise)'
doc_version: '1.0.0'
status: active
last_review: '2026-08-29'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal', 'kind/analysis']
related: ['ship', 'gold-audit']
---

# Tabletop (use-case exercise)

**Goal:** walk one concrete journey the way a user lives it and record every point where the
documentation, the CLI, a hook, a gate or CI disagree. Tests assert expectations someone
already had; a tabletop walks the composition and asks, at each step, whether what the doc
says matches what happens.

**Input:** a scenario slug from `docs/internal/METHOD/TABLETOP-SCENARIOS.md`, or a free-text
use case — slugify it (`^[a-z0-9]+(-[a-z0-9]+)*$`) and supply the five fields yourself.

**Evidence only.** A tabletop never modifies the repository: no edits, no commits, no
generated files, no `--fix`, no issue opened mid-walk. A step that would write is executed
as `--dry-run` or described and left unrun.

---

## Step 1 — Open the scenario

State, before walking: **persona**, **starting state**, **goal**, **the docs the user would
read** (real paths), **the exit criterion**. Pin the tree: `git rev-parse HEAD`.

## Step 2 — Walk the journey in character

Narrate each step in the first person as the persona — what they want, what they type, what
they see. At every step do all three:

- **(a) Execute** what is safely executable read-only or dry-run: `arbiter <cmd> --dry-run`,
  `<cmd> --help`, rendering a template with the project's config, reading the doc the user
  would read, running an existing check. Never a mutating command.
- **(b) State the promise** — quote what the documentation says happens here, with
  `path:line`.
- **(c) Record observed vs promised** — one findings row per disagreement.

A step whose behaviour cannot be executed is still walked: read the code path that would
run, and record the observation as `not executable — read <path>`.

## Step 3 — Classify every finding

| column                     | value                                                           |
| -------------------------- | --------------------------------------------------------------- |
| `step`                     | the step number in this walk                                    |
| `doc claim (path:line)`    | the promise, cited                                              |
| `observed`                 | what actually happened, verbatim                                |
| `severity`                 | `blocker` / `major` / `minor`                                   |
| `class`                    | `phantom-command` / `doc-drift` / `missing-gate` / `ux` / `bug` |
| `proposed permanent check` | the test or gate that would have caught it                      |
| `owner`                    | `#NNN`, an https URL, or `fixed:<sha>` — required at major+     |

- **blocker** — the journey cannot continue: a documented command does not exist, or a step
  fails closed with no recovery.
- **major** — the journey continues but the user is misled, or a governance promise is
  unenforced.
- **minor** — cosmetic, or a phrasing gap with no behavioural consequence.

A tabletop is high-recall and low-precision on purpose. Over-report, then let severity and
the owner column do the filtering.

## Step 4 — Write the evidence file

Write `.arbiter/evidence/tabletop/<slug>-<YYYY-MM-DD>.md` — this is the ONE file a tabletop
creates:

```markdown
---
scenario: greenfield-init-ts
sha: <full sha from Step 1>
date: 2026-08-29
persona: TypeScript library author installing arbiter for the first time
steps: 7
findings:
  blocker: 0
  major: 1
  minor: 2
---

# Tabletop — greenfield-init-ts

<one paragraph: the journey, in the persona's words>

| step | doc claim (path:line) | observed | severity | class     | proposed permanent check | owner |
| ---- | --------------------- | -------- | -------- | --------- | ------------------------ | ----- |
| 2    | docs/QUICKSTART.md:31 | ...      | major    | doc-drift | ...                      | #2429 |
```

The `findings` counts MUST equal the table's row counts per severity —
`node scripts/check-tabletop-evidence.mjs` fails the build otherwise.

## Step 5 — Terminate every finding

- Every **blocker** and **major** ends as a filed issue (`owner: #NNN`) or a fix landed on
  the same train (`owner: fixed:<sha>`). An unowned blocker or major fails the gate.
- Every **behaviour** finding proposes the test or gate that would have caught it, named
  concretely (`__tests__/…`, `scripts/check-….mjs`, a CI job) — never "add a test".
- Report to the user: the evidence path, the counts, and the blocker list.

## Hard rules

- **Evidence only** — never modify the repository during a tabletop. Findings are recorded,
  not fixed, inside the walk.
- **Cite or drop it.** A finding without a `path:line` promise and a verbatim observation is
  an opinion; delete the row.
- **No invented output.** Every `observed` cell is a command's real output or a file's real
  content. Never narrate a command you did not run.
- **Terminate in checks.** A tabletop that produces findings but no proposed checks has
  bought one-off recall and no regression protection.
