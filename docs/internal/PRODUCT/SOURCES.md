---
title: 'External sources'
doc_version: '1.0.0'
status: active
last_review: '2026-09-04'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# External sources (SRC-NNN)

A URL in a document proves nothing: the page can change, or can never have said what it is cited
for. A source is admitted here only with a **committed, citation-length excerpt** and a sha256 of
that excerpt, so every quotation this project makes is checkable offline, by machine, against
evidence that cannot drift without the gate noticing.

`scripts/check-sources.mjs` (INV-147) enforces tier 1: the excerpt exists, hashes to what was
recorded, and contains each `quoted_text` **literally**. Both halves are needed — a substring check
alone passes on an excerpt edited after the fact, and a hash alone says nothing about whether the
quotation appears at all.

The `url` is recorded provenance and is **never dereferenced** by the gate: a check that fails when
a website is down fails for a reason unrelated to the claim it guards.

`selected_by_user: false` means the source was gathered by an agent and has not been ratified by a
human. It is recorded honestly rather than implied — adoption is a human act.

<!-- SOURCES_START -->

```json
{
  "sources": [
    {
      "id": "SRC-001",
      "title": "MADR \u2014 Markdown Architectural Decision Records",
      "url": "https://adr.github.io/madr/",
      "kind": "spec",
      "retrieved_at": "2026-09-04",
      "excerpt_path": "docs/sources/excerpts/SRC-001.txt",
      "content_hash": "362a9ef1b4dd94026015c8be138bbdd5f5bb05aeb2df55d9fab2637a9d93317c",
      "citations": [
        {
          "quoted_text": "An Architectural Decision (AD) is a justified software design choice that addresses a functional or non-functional requirement of architectural significance.",
          "note": "The definition arbiter's ADR contract leans on: an ADR records a JUSTIFIED choice, which is why docs/internal/ADR frontmatter carries `enforces:` and why check-adr-enforcement.mjs ratchets coverage rather than treating the field as optional decoration."
        }
      ],
      "selected_by_user": false,
      "informs": ["INV-107"],
      "application_status": "cited"
    },
    {
      "id": "SRC-002",
      "title": "arc42 Template Overview",
      "url": "https://arc42.org/overview/",
      "kind": "standard",
      "retrieved_at": "2026-09-04",
      "excerpt_path": "docs/sources/excerpts/SRC-002.txt",
      "content_hash": "f6e207db63b3b6ccf7c1fbfe81daf188dfe3c0b3e2ef62559f7b373d205bfd78",
      "citations": [
        {
          "quoted_text": "Twelve sections, each with a clear purpose, tailorable to your specific needs.",
          "note": "The upstream authority for INV-144's twelve addressable slots. arbiter does not invent the enumeration; ARC-01..ARC-12 are arc42's own sections, which is why the gate READS the required set from the skeleton rather than restating it."
        }
      ],
      "selected_by_user": false,
      "informs": ["INV-144"],
      "application_status": "cited"
    }
  ]
}
```

<!-- SOURCES_END -->
