---
title: 'Secure Coding Checklist'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/security']
related: []
---

# Secure Coding Checklist

_arbiter self-config — TypeScript L3. Review before every PR merge._

## Input Validation

- [ ] All user input validated at system boundaries (no raw string interpolation in SQL/shell/HTML)
- [ ] Parameterized queries only — no string concatenation in database calls
- [ ] File uploads: validate type, size, and filename; store outside webroot
- [ ] JSON/XML input parsed with size limits

## Authentication & Authorization

- [ ] JWT tokens validated (signature + expiry + audience)
- [ ] No hardcoded credentials in source code or config files
- [ ] Default-deny authorization: explicit allow-list, not blocklist
- [ ] Session tokens invalidated on logout and password change

## Secrets

- [ ] No secrets in source code, logs, or version control
- [ ] Environment variables used for all configuration values
- [ ] Secret scanning gate passes (`gitleaks detect`)
- [ ] Secrets rotated if any exposure suspected

## Dependency Security

- [ ] `npm audit --omit=dev --audit-level=high` passes
- [ ] Consumer-resolution audit passes (`node scripts/check-consumer-audit.mjs`, #1718): packs the
      publishable tarball, installs it into a throwaway root with no repo `overrides`/devDeps, and
      audits that tree at a stricter `moderate` floor — closes the blind spot where npm silently
      drops root `overrides` for anyone who installs `@arbiter/cli` as a dependency
- [ ] No CVEs suppressed without justification + review date
- [ ] CVSS ≥ 9.0 CVEs must have written ADR before suppression
- [ ] Dependencies pinned to minor version or have lockfile

## Error Handling

- [ ] No stack traces in API responses (structured error format only)
- [ ] All Promise rejections handled (`.catch()` or `try/catch`)
- [ ] No swallowed exceptions (`catch {}` without logging or rethrow)
- [ ] Error codes documented — no magic numbers in error responses

## Logging & PII

- [ ] No PII in log output (names, emails, phone numbers, IDs)
- [ ] Correlation ID present in all service-to-service calls
- [ ] Log level appropriate: debug not in production by default
- [ ] PII scan gate passes (`node scripts/pii-scan.mjs`)
