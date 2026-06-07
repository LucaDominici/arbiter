---
generated: true
source: 'docs/METHOD/CONTEXT_SLICE_SPEC.md'
source_sha: '13c92ac3fd88b7a59cd67e710789d49f68e6d507'
last_updated: '2026-06-07'
---

# CONTEXT_SLICE Specification — arbiter

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/CONTEXT_SLICE_SPEC.md](../docs/METHOD/CONTEXT_SLICE_SPEC.md)

# CONTEXT_SLICE Specification — arbiter

**Purpose:** Define the atomic verbatim-extraction unit used across arbiter.
A CONTEXT_SLICE is a single self-describing block containing the byte-for-byte
content of one contiguous line range of one source file, plus the metadata
needed to verify the extract.

**Location:** `docs/METHOD/CONTEXT_SLICE_SPEC.md`
**Generator:** `scripts/emit-context-slice.mjs`
**Consumed by:** `scripts/emit-context-pack.mjs` (and any future tool that
needs to cite a source range without summarising it).

> Not to be confused with `CONTEXT_PACK_SPEC.md`: a CONTEXT*PACK is a \_bundle*
> of slices plus invariant and canon metadata. A CONTEXT_SLICE is one extract.

---

## Doctrine: Verbatim or Nothing

Constraint documents are _law_. A single missing word — `MAY` vs `MUST`,
`recommended` vs `required` — can flip compliance. A CONTEXT_SLICE therefore
forbids:

- Paraphrase.
- Reformatting (whitespace, line endings, indentation).
- Translation, summarization, or any LLM-rewrite mid-extract.
- Mid-extract insertion of editorial notes or markers.

The slice body MUST be byte-identical to the cited line range of the source
file. The emitter MUST fail rather than emit a slice it cannot guarantee.

This doctrine is **internal**. External materials still follow arbiter's
plagiarism policy and are never the source of a CONTEXT_SLICE.

---

## Schema

A CONTEXT_SLICE is a Markdown document with the following shape. Heading and
field names are exact.

```text
# CONTEXT_SLICE
- spec_version: 1.0.0
- source: <path>:L<start>-L<end>
- line_count: <N>
- byte_count: <M>
- sha256: <64 lowercase hex chars>

<verbatim body, exactly the cited line range>
```

### Field Rules

- **`spec_version`** — fixed string `1.0.0` for this revision.
- **`source`** — repo-relative POSIX path, a literal `:L`, the inclusive start
  line, a literal `-L`, then the inclusive end line. 1-indexed. `L5-L5` is a
  legal single-line slice.
- **`line_count`** — `end - start + 1`. Always positive.
- **`byte_count`** — UTF-8 byte length of the body, after the body is
  reconstructed from the cited line range (see _Body Reconstruction_).
- **`sha256`** — sha256 of the body bytes (lowercase hex, 64 chars). The hash
  is over the body alone, not over the header. This makes the hash a property
  of the source, not of the emitter run.

### Body Reconstruction

The body is the slice of the source file from the first byte of line `start`
through the trailing newline of line `end` (or through EOF if `end` is the
final line and the file lacks a trailing newline). Lines are split on `\n`.

If the source file uses CRLF line endings, the emitter preserves them
verbatim — the slice reflects the file as it exists on disk. The emitter does
not normalise line endings, tab widths, or trailing whitespace.

### Separator

Exactly one blank line separates the header block from the body. The body
ends with whatever bytes the source contains in the cited range; no extra
newline is appended after the body.

---

## CLI

```text
node scripts/emit-context-slice.mjs --source <path> --lines <start>-<end> [--out <path>]
```

- `--source` — required. Repo-relative path to the source file. Must exist
  inside the repository root; absolute and parent-traversing paths are
  rejected.
- `--lines` — required. Inclusive `<start>-<end>` line range, 1-indexed. A
  single line is expressed as `<n>-<n>`.
- `--out` — optional. When supplied, the slice is written to this path and
  stdout stays empty. Otherwise the slice is written to stdout.

Exit codes:

- `0` — slice emitted successfully.
- `2` — argument error (missing flag, malformed range, out-of-bounds range, or source file not found).

---

## Determinism

Same `(source bytes, line range)` MUST yield byte-identical slice output. The
emitter MUST NOT include timestamps, hostnames, PIDs, or any other unstable
inputs. Repeated emission is a fixed-point check: any drift is a defect.

---

## Verification

Consumers verify a CONTEXT_SLICE by:

1. Resolving `source` relative to the repo root.
2. Reading the file and selecting the line range.
3. Comparing the reconstructed body byte-for-byte to the slice body.
4. Recomputing sha256 of the body and comparing to the `sha256` field.

Any mismatch invalidates the slice. The consumer MUST NOT trust the slice
content over the source file — the source is the ground truth.

---

## Compatibility With CONTEXT_PACK

A CONTEXT_PACK excerpt block (see `CONTEXT_PACK_SPEC.md` §Schema) is a
flattened CONTEXT_SLICE: it carries `source: <path>:L<n>-L<m>` plus the
verbatim body, but omits the per-slice hash because the whole pack is hashed
in its footer. CONTEXT_PACK and CONTEXT_SLICE therefore agree on the
verbatim-extract doctrine and on the `path:L<n>-L<m>` citation format.

---

## Stability

Schema additions are minor revisions and bump the second digit of
`spec_version`. Field removal or semantic changes bump the major digit and
require a coordinated migration of consumers.

---

## Non-Goals

- Multi-file slices. A CONTEXT_SLICE cites exactly one file.
- Non-contiguous ranges. The cited range is a single `[start, end]` pair.
- Signing or encryption. Integrity is provided by the body hash; provenance
  of the slice itself is the caller's concern.
- Streaming or chunked output. Slices are emitted atomically.

## See Also

- [[method-context-pack-spec]] — related
- [[method-track-model]] — related
