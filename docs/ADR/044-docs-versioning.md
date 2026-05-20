---
title: 'ADR-004: Docs Site Versioning Strategy'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-004: Docs Site Versioning Strategy

**Project:** arbiter
**Date:** 2026-05-15
**Status:** Accepted
**Reference:** Issue #523

## Context

As arbiter ships stable releases, users pinned to an older version need access to the matching documentation. Two hosting strategies are common: subdomains per version (`v0.vitepress.dev`, `v1.vitepress.dev`) vs subpath routing under a single deploy (`arbiter.dev/v/0.x/`). A decision is needed before the first tagged release so that release tooling can be wired correctly.

## Decision

Docs versioning uses **subpath routing** under a single Cloudflare Pages deploy:

| Path          | Content                      |
| ------------- | ---------------------------- |
| `/`           | Current development (`next`) |
| `/v/latest/`  | Most recent stable release   |
| `/v/<x.y.z>/` | Snapshot per tagged release  |

The version switcher in the nav bar lists `v0 (next)` and `v0.1 (latest)` initially; new entries are appended on each tagged release.

Per-tag snapshot wiring (the release workflow step that copies `website/dist/` into a versioned subpath) is deferred until Cloudflare Pages is connected (tracked on issue #518). The nav entry for `latest` is decorative until the first snapshot lands.

## Rationale

**Subpaths over subdomains:**

- Single deploy = single cache, single analytics view, simpler CORS.
- Cloudflare Pages supports `_redirects` for canonical URL enforcement without additional DNS entries.
- VitePress `base` config rewrite is simpler than managing N independent deploys.

**Deferring snapshot workflow:**

- The nav entry and version switcher ship now so the UI is complete at launch.
- The automated snapshot step requires a working CI → CF Pages publish pipeline (#518), which is an external account dependency.
- No functional regression: `/v/latest/` returns a 404 until the first snapshot lands, which is acceptable for a pre-v1.0 site.

## Consequences

### Positive

- No extra DNS entries or CF Pages projects per release.
- `canonical` meta tag on `/` prevents duplicate-content indexing of `/v/next/`.
- Version switcher nav is ready for the first stable release.

### Negative

- `/v/latest/` 404s until #518 (Cloudflare Pages) and the first tagged release both land.
- Subpath rewrites require `_redirects` file discipline; stale rewrites accumulate over time.
