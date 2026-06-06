---
generated: true
source: 'docs/METHOD/CONTEXT_PACK_SPEC.md'
source_sha: '6e02e16318e4cb31e5b10b4b19406f3bd82c4ccd'
last_updated: '2026-06-06'
---

# CONTEXT_PACK Specification — arbiter

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/CONTEXT_PACK_SPEC.md](../docs/METHOD/CONTEXT_PACK_SPEC.md)

# CONTEXT_PACK Specification — arbiter

**Purpose:** Define the deterministic context-bundle artifact emitted per task.
A CONTEXT_PACK is the minimum signed slice of authoritative documentation an
agent needs to verify a plan or implementation against arbiter's governance
without re-reading the whole repository.

**Location:** `docs/METHOD/CONTEXT_PACK_SPEC.md`
**Generator:** `scripts/emit-context-pack.mjs`
**Runtime artifact:** `<repo>/.arbiter/context-pack/<task-id>.md`

> Not to be confused with `docs/METHOD/TRACK_ROUTER.md.ejs` (query routing for
> agents) or `docs/METHOD/TRACK_MODEL.md` (work-scope taxonomy). This SPEC
> governs the bundle format itself; the TRACK_MODEL informs which subset is
> selected for a given task.

---

## Authority Chain

A CONTEXT_PACK is a derived artifact. When sources disagree, the higher tier
wins:

1. **`GLOBAL_INVARIANTS.md`** — invariants are the constitutional layer. The
   pack quotes them verbatim with line citations; the pack never paraphrases
   an invariant.
2. **`docs/METHOD/KNOWLEDGE_MAP.md`** — explicit routing rules. If the map
   contains a rule that matches the task track or touched files, that rule
   selects the excerpts.
3. **`docs/METHOD/CONTEXT_PACK_SPEC.md`** (this file) — default heuristics
   used when KNOWLEDGE_MAP has no matching rule.
4. **`<repo>/.arbiter/context-pack/<task-id>.md`** — the signed slice emitted
   for the task. Not authoritative on its own; it is a snapshot of the three
   tiers above.

A CONTEXT_PACK that disagrees with a higher tier is invalid. Re-emit; do not
hand-edit.

---

## Key Properties

A valid CONTEXT_PACK MUST be:

- **Deterministic** — same inputs yield byte-identical output. No timestamps,
  hostnames, PIDs, or unstable map orderings.
- **Traceable** — every excerpt cites its source as `<path>:L<start>-L<end>`,
  byte-equivalent to the cited line range.
- **Self-contained** — verifying the pack requires reading only the pack and
  the cited source files. No transitive lookups.
- **Minimal** — only invariants, canon rules, and excerpts the task actually
  needs. Bloating the pack defeats its purpose.

---

## Schema

A CONTEXT_PACK is a structured Markdown document with the following sections,
in order. Section headings are exact.

```text
# CONTEXT_PACK — <task-id>

## Header
- spec_version: 1.0.0
- task_id: <task-id>
- track: <track-name>
- emitted_from: scripts/emit-context-pack.mjs

## Task Identity
- task_id: <task-id>
- track: <track-name>
- files: [<comma-separated list of paths or "(none)">]
- routing_source: explicit-rule | spec-default

## INV Set
- INV-NN
- INV-NN
- ...

## CANON Set
- CANON-NN
- CANON-NN
- ...

## Excerpts

### <slug-derived-from-source>
source: <path>:L<start>-L<end>

<verbatim content from the cited line range>

### <next slug>
source: <next-path>:L<start>-L<end>

<verbatim content>

## Footer
- excerpt_count: <integer>
- hash: sha256:<64 lowercase hex chars>
```

### Section Rules

- **Header** — fixed-shape metadata. Never includes timestamps.
- **Task Identity** — echoes the CLI arguments. `routing_source` is
  `explicit-rule` if KNOWLEDGE_MAP matched, `spec-default` otherwise.
- **INV Set** — sorted ascending by numeric tail (INV-01 before INV-12).
- **CANON Set** — sorted ascending by numeric tail. Empty list rendered as
  the literal line `- (none)`.
- **Excerpts** — sorted by `(source path lexicographic, line_start ascending)`.
  Each excerpt block starts with `source: <path>:L<start>-L<end>` on its own
  line, then a blank line, then the verbatim cited range.
- **Footer** — `excerpt_count` is the integer number of `### ` excerpt
  headings; `hash` is the sha256 of the canonical body (defined below).

### Hash Rule

`hash` is computed over the UTF-8 bytes of the pack **from the first character
of `# CONTEXT_PACK` up to and including the newline after the `## Footer`
heading and the `- excerpt_count: ...` line**, i.e. every byte the pack
produces except the trailing `hash:` line itself. This makes the hash a
fixed-point property: regenerating the pack with identical inputs reproduces
the same hash.

---

## Resolution Order for Routing

Given a task tagged with a track and zero or more touched files, the emitter
selects invariants and excerpts in this order:

1. **Explicit KNOWLEDGE_MAP rule** — if `docs/METHOD/KNOWLEDGE_MAP.md`
   contains a fenced `routes:` block (YAML) with a rule matching the track
   or any touched file, that rule's `invariants:`, `canon:`, and `excerpts:`
   lists are used. Sets `routing_source: explicit-rule`.
2. **SPEC default by track** — if no explicit rule matches, the default
   per-track set defined below applies. Sets `routing_source: spec-default`.
3. **Baseline** — every pack also includes the minimal baseline
   `INV-01, INV-12, INV-13` regardless of source, merged with the
   above (deduplicated, sorted).

The baseline guarantees that no pack is ever empty and that the three
project-wide constants (no circular deps, no PII, dependency scanning) are
always asserted.

### v1 Defaults per Track

| Track       | Default invariants     | Default canon                | Default excerpts     |
| ----------- | ---------------------- | ---------------------------- | -------------------- |
| `core`      | INV-04, INV-05, INV-06 | CANON-16                     | (touched files only) |
| `templates` | INV-04                 | CANON-04, CANON-13, CANON-16 | (touched files only) |
| `kit`       | INV-04                 | CANON-02, CANON-03           | (touched files only) |
| `docs`      | (baseline only)        | (none)                       | (touched files only) |
| `ci`        | INV-13                 | CANON-18, CANON-19           | (touched files only) |
| `meta`      | (baseline only)        | (none)                       | (touched files only) |

"Touched files only" means: if the CLI is invoked with `--files a,b,c`, the
emitter includes one excerpt per file, citing lines 1 through the file's last
line. Future revisions of this SPEC may add narrowing heuristics.

---

## Verbatim Extract Rule

When the pack includes content from another arbiter document, the extract
MUST be a byte-for-byte copy of the cited line range. The emitter MUST NOT
paraphrase, reformat, or summarize mid-extract. This applies to invariants,
canon entries, and file excerpts alike.

This rule is **internal to arbiter sources**. It does not relax arbiter's
external-source plagiarism policy: external materials are paraphrased per
project policy and are never quoted into a CONTEXT_PACK.

---

## CLI

```text
node scripts/emit-context-pack.mjs --task-id <#NNN> --track <name> [--files a,b,c] [--out path]
```

- `--task-id` — required. The task identifier (e.g. `#975`).
- `--track` — required. One of the tracks defined in `TRACK_MODEL.md`.
- `--files` — optional. Comma-separated list of touched files (paths
  relative to repo root).
- `--out` — optional. If supplied, the pack is written to this path and
  stdout stays empty. Otherwise the pack is written to stdout.

### Determinism Requirements (Generator)

The emitter MUST:

- Read invariants from `GLOBAL_INVARIANTS.md` by locating headings
  `### INV-NN: ...` and extracting until the next horizontal rule (`---`)
  or next `### INV-` heading, whichever comes first.
- Sort all collections (invariants, canon, excerpts) using the rules above.
- Not depend on `process.hrtime`, `Date.now()`, environment variables, or
  filesystem ordering. All inputs MUST be hashable.
- Emit `\n`-terminated lines on every platform.

---

## Versioning

The `spec_version` header field is bumped according to
`docs/METHOD/DOC_SEMVER.md`:

- **MAJOR** — schema sections renamed or removed; existing packs become
  invalid.
- **MINOR** — new optional fields or sections; existing packs still parse.
- **PATCH** — documentation clarifications; format unchanged.

Packs with `spec_version` MAJOR less than the current SPEC MUST be rejected
by downstream tools that consume the pack.
