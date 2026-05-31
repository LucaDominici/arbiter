---
title: 'ADR-065: Auth provider abstraction (#726)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '065'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-065: Auth provider abstraction (#726)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #726 (wave:2-medium, provider-abstraction); CANON-04, CANON-05, CANON-11

**Context:** Auth setup is the most variable aspect of a new project — it ranges from rolling your own session middleware to operating a full Keycloak cluster. Providing a single template would be either too opinionated or too generic to be useful.

**Decision:**

- New optional `AuthConfig` type (`provider`, `protocols`, `tenantIsolation`, `themeSync`) added to `ProjectConfig`.
- `generateAuth` returns empty `files: []` when `auth` is absent or `provider === 'none'` — fully opt-in.
- Single unified template `src/templates/auth/setup.md.ejs` with per-provider conditional blocks (10 providers: app-level-ts, authelia, authentik, ory-stack, zitadel, keycloak, saas-clerk, saas-auth0, saas-supabase-auth, saas-cognito).
- Email placeholders use `alice@<your-domain>` rather than `user@example.com` to pass the PII guard (INV-12).
- Registry key `'auth'`; PATH_TO_KEYS entry `'auth.provider' → ['auth']` for selective re-runs.
- Bundled with #725 in one PR (same wave, same structural pattern, same authoring cost).

**CANON-16 survey:** grepped `src/generators/` for auth/identity generators — none found. Grepped `src/templates/` — no auth directory. New files justified.

**Consequences:** Projects that set `auth.provider` receive a complete, provider-specific auth setup guide. Self-hosted stacks include docker-compose definitions; SaaS providers include SDK init and JWT validation patterns.
