---
name: clean-code
description: Clean Code principles (DRY, KISS, YAGNI), naming conventions, and refactoring. Use when reviewing code quality or improving readability.
---

# Clean Code

## Core Principles

| Principle | Rule                     | Violation Sign                |
| --------- | ------------------------ | ----------------------------- |
| **DRY**   | Don't Repeat Yourself    | Copy-pasted logic blocks      |
| **KISS**  | Keep It Simple           | Over-engineered solutions     |
| **YAGNI** | You Aren't Gonna Need It | Features added "just in case" |

## Naming

- Names should reveal intent
- Avoid abbreviations unless universally known (`i`, `err`, `ctx`)
- Functions: verb + noun (`getUserById`, `calculateTotal`)
- Booleans: `is`, `has`, `can` prefix (`isActive`, `hasPermission`)

## Functions

- One level of abstraction per function
- Max ~20 lines — if longer, extract
- No more than 3 parameters — use a config object if more are needed
- No side effects in pure calculation functions

## Comments

- Comments explain **why**, not **what**
- If you need a comment to explain **what**, the code needs renaming
- Delete commented-out code — use git history instead

## TypeScript-Specific

- No `any` — use `unknown` and narrow, or define a type
- Prefer `const` over `let`; avoid `var`
- Use discriminated unions over nullable fields
- Small interfaces over large ones (Interface Segregation)

## Refactoring Moves

1. **Extract function** — repeated code block → named function
2. **Rename** — confusing name → intent-revealing name
3. **Inline** — one-liner wrapper that adds no clarity
4. **Extract variable** — complex expression → named variable
5. **Replace condition with polymorphism** — long if/else on type → strategy pattern
