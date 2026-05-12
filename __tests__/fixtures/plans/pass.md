# Plan: Add user-profile endpoint

## Scope

Create a new GET /users/:id endpoint that returns the user profile JSON.

Files:

- `src/api/users.ts` — handler implementation
- `src/api/users.test.ts` — vitest cases for OK / 404 / 401
- `docs/REFERENCE/CLI.md` — append API reference row

## Test plan

Write failing tests first (TDD):

1. Authenticated request returns 200 + JSON body
2. Unauthenticated request returns 401
3. Unknown user id returns 404

Tests use the existing `mockSession` helper. No new fixtures needed.

## Gate command

```
node scripts/check-all.mjs L1
```

## Risk

- Existing `findUserById` does not enforce row-level permissions for
  multi-tenant data. The handler must call `assertTenantOwns(userId)`
  before returning, or it leaks data across tenants.

## SSOT updates

- AGENTS.md unchanged
- Update `docs/REFERENCE/CLI.md` with the new endpoint row.
