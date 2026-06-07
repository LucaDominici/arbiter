---
generated: true
source: 'docs/rfc/README.md'
source_sha: '68ebd0f0b95c5a1fe89eab9690b29ca8646ee8fe'
last_updated: '2026-06-07'
---

# RFC Process

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/rfc/README.md](../docs/rfc/README.md)

# RFC Process

Arbiter uses a lightweight RFC (Request for Comments) process for significant changes — new plugin API surfaces, new governance levels, changes to the skills matrix schema, and anything that would break existing integrations.

Small bug fixes, doc improvements, and minor enhancements do **not** need an RFC — open a regular issue.

---

## When to write an RFC

Write an RFC when your change:

- Modifies the public plugin API (`ArbiterPlugin`, `PluginContext`, `PluginResult`)
- Adds or removes a governance level
- Changes the skills-matrix schema or detect-and-reference posture
- Alters `AGENTS.md` generated structure in a way that requires existing projects to update
- Introduces a new CLI flag that affects generated artifacts

---

## Process

1. **Copy** `docs/rfc/0000-template.md` to `docs/rfc/NNNN-short-title.md` (replace `NNNN` with the next available number).
2. **Fill in** all sections. "Unresolved Questions" is required — leave it empty only if there genuinely are none.
3. **Open a PR** with just the RFC file. Set the PR title to `RFC NNNN: <short title>`.
4. **7-day comment window** — the PR stays open for at least 7 calendar days after the last substantive edit.
5. **Acceptance** requires: ≥1 maintainer approval + ≥1 community contributor approval (or a second maintainer if no community approval within 14 days).
6. **Merge** the RFC as `accepted` and set `status: accepted` in the frontmatter.
7. **Deferred** RFCs are closed with `status: deferred` and a summary of why.

Implementation PRs link back to the accepted RFC with `Implements RFC NNNN`.

---

## RFC numbering

RFCs are numbered sequentially. The first accepted RFC is `0001`. Leave `0000` as the permanent template.

## Index

| #                             | Title                 | Status   |
| ----------------------------- | --------------------- | -------- |
| [0001](0001-plugin-api-v2.md) | Plugin API v2 surface | accepted |
