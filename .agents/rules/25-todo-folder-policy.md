# TODO Policy

- Every TODO comment in source code MUST reference a task ID: `TODO(#NNN): description`
- Bare `TODO` or `TODO: description` without a task ID is a gate violation (INV-06)
- Enforced by the `check-no-orphan-todo.sh` post-edit hook
