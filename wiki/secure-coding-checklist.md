---
generated: true
source: 'docs/SECURE_CODING_CHECKLIST.md'
source_sha: '5807161bca9f43dd7fb9a389181a0017cb78d4ca'
last_updated: '2026-06-09'
---

# Secure Coding Checklist

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SECURE_CODING_CHECKLIST.md](../docs/SECURE_CODING_CHECKLIST.md)

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

- [ ] `npm audit --audit-level=high` passes
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
