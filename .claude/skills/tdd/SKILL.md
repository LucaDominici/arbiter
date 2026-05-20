---
name: tdd
description: Use when implementing any feature or bugfix. Red-Green-Refactor cycle enforced. Write the failing test first, then minimal implementation.
title: 'Test-Driven Development'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Test-Driven Development

**Iron Law:** No production code without a failing test first.

## Red-Green-Refactor

1. **RED** — Write one failing test for the next behavior
2. **Verify RED** — Run the test, confirm it fails for the right reason
3. **GREEN** — Write minimal code to pass
4. **Verify GREEN** — Run all tests, all pass
5. **REFACTOR** — Clean up without breaking tests

## Test Command

```bash
npm run test
```

## Stack: typescript

**Test runner:** vitest

```typescript
import { describe, it, expect } from 'vitest'

describe('feature', () => {
  it('does the expected thing', () => {
    // Arrange
    // Act
    // Assert
    expect(result).toBe(expected)
  })
})
```

## Rules

- One behavior per test
- Watch each test fail before implementing
- Minimal code to pass — no extra features
- Refactor only after green

## When to Skip TDD

Only with explicit user permission. "This is simple" is never a reason.
