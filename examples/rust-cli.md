# Example: rust-cli

End-to-end walkthrough of `arbiter init` on a Rust CLI binary. The starter mirrors the reference fixture at `__tests__/fixtures/real-projects/rust-cli/`.

## 1. Starter project (before `arbiter init`)

A minimal Clap-based CLI binary. Arbiter detects the `cli` archetype automatically from the `[[bin]]` section in `Cargo.toml` and the `clap` dependency.

```
rust-cli/
├── Cargo.toml             # clap 4 (derive feature)
├── manifest.json          # { language: "rust", archetype: "cli", buildTool: "cargo", levels: ["L1","L2","L3"] }
└── src/
    └── main.rs
```

`Cargo.toml` (reference shape):

```toml
[package]
name = "rust-cli-fixture"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "rust-cli-fixture"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
```

## 2. Run `arbiter init`

```bash
npx @arbiter/cli init \
  --dir ./rust-cli \
  --tools claude \
  --level L2
```

Arbiter detects language and archetype automatically. To override, pass `--archetype cli --language rust`.

## 3. Generated artifacts

**Governance contract**

- `AGENTS.md` — canonical AI-agent rules, invariants, gate command (`cargo clippy`, `cargo test`, `cargo fmt --check`).
- `arbiter.json` — installer-level config.
- `.arbiter-generated.json` — manifest of every file arbiter emitted.

**Gate scripts**

- `scripts/check-all.mjs` — orchestrator (L1 / L2 / L3); shells out to `cargo`.
- `scripts/check-no-orphan-todo.mjs`, `scripts/check-no-placeholders.mjs` and other invariant checks referenced by `check-all.mjs`.

**Git hooks**

- `.githooks/pre-commit` — runs `node scripts/check-all.mjs L1`.
- `.githooks/pre-push` — runs `node scripts/check-all.mjs L2`.

**AI-tool configs (Claude Code, because `--tools claude`)**

- `.claude/CLAUDE.md` — thin pointer to AGENTS.md.
- `.claude/settings.json` — hook wiring.
- `.claude/hooks/` — enforcement hooks (check-no-direct-spawn, pre-edit-ssot-guard, stop-dangerous, etc.).
- `.claude/rules/*.md` — always-loaded rules.

**CI**

- `.github/workflows/ci.yml` — runs `node scripts/check-all.mjs L2` on every PR. Installs Rust toolchain via `dtolnay/rust-toolchain`.

**Tooling configs**

- `.gitleaks.toml`, `.editorconfig`, `commitlint.config.js`.

## 4. Run the gate

```bash
npm install                       # installs git hooks via prepare script
node scripts/check-all.mjs L1     # fast: clippy + fmt + cargo test
node scripts/check-all.mjs L2     # full: L1 + cargo audit + gitleaks
```

Cargo must be available in PATH. The CI workflow installs it automatically; locally you need [rustup](https://rustup.rs).

## 5. See the enforcement chain fire

Add an `unwrap()` call in `src/main.rs`:

```rust
let args = std::env::args().collect::<Vec<_>>().first().unwrap().clone();
```

Try to commit:

```bash
git add src/main.rs
git commit -m "feat: test"
```

The pre-commit hook runs `node scripts/check-all.mjs L1`, which invokes `scripts/check-rust-no-unwrap.mjs`. The commit is rejected with: `unwrap() is banned — use ? or explicit error handling`.

Fix by propagating the error:

```rust
let args = std::env::args().next().ok_or("no argv[0]")?;
```

## 6. Typical follow-up edits

- Add a new subcommand under `src/commands/`. The `pre-edit-plan-anchor.mjs` hook requires an active plan in `implementation` phase.
- Add an ADR in `docs/SYSTEM/DECISIONS.md` for any architectural choice.
- Run `cargo update` to bump dependencies; the gate will catch any new `unwrap` calls introduced by updated deps.
