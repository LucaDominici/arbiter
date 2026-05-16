# Frequently Asked Questions

**Issue:** #533

---

**What is arbiter?**  
arbiter is a CLI tool that generates governance configuration for AI coding agents. Run `arbiter init` in a project and it produces AGENTS.md, hook scripts, and CI checks that constrain how AI agents behave during development.

---

**Who is arbiter for?**  
Teams using AI coding agents (Claude Code, Copilot, Cursor, Codex) who want consistent, mechanically enforced governance rather than convention. It is most useful once a team has experienced inconsistency caused by agents ignoring or forgetting their rules.

---

**Does arbiter collect telemetry?**  
No. Zero telemetry, zero analytics, zero network calls from arbiter itself. See [PRIVACY.md](../PRIVACY.md).

---

**What languages does arbiter support?**  
TypeScript, Java (Gradle + Maven), Rust, Go, Python, and multi-language monorepos. Framework detection covers Next.js, Express, Fastify, Tauri, Vue, React, Spring Boot, Quarkus, and combinations.

---

**What AI tools does arbiter support?**  
Claude Code (full support), GitHub Copilot, Cursor, and Codex. Support is tiered by how well each tool can consume the generated configuration.

---

**Do I need to install arbiter globally?**  
Yes, `npm install -g @arbiter/cli` is the recommended approach. Alternatively, use `npx @arbiter/cli init` for a one-shot run. Local per-project install is not recommended.

---

**What is a governance level?**  
arbiter supports three levels: L1 (lightweight), L2 (standard), and L3 (strict). Higher levels enforce more invariants and add more gate checks. Start with L1 for brownfield projects, L2 for new projects, L3 for regulated or security-sensitive projects.

---

**What is an invariant?**  
An invariant is a rule your project must always satisfy — e.g., "no `any` types in TypeScript" or "all TODOs must reference a task ID." arbiter maintains a catalog of 50+ invariants, filtered by language, archetype, and governance level.

---

**Does arbiter work on brownfield (existing) codebases?**  
Yes. Use `arbiter init --governance l1` to start conservatively. Existing violations appear as warnings; add them to suppression baselines and enforce going forward. See the brownfield onboarding guide (issue #649 — in progress).

---

**Does arbiter work on Windows?**  
Via WSL2 (Windows Subsystem for Linux). Native Win32 is not supported. See the WSL2 setup guide.

---

**How does arbiter differ from Husky or lefthook?**  
Husky and lefthook manage git hooks but leave rule definition to you. arbiter generates the rules, generates the hooks, enforces them in CI, and maintains a documented invariant catalog. They are complementary: arbiter can generate configs that use Husky as the hook runner.

---

**How does arbiter differ from ESLint / Biome?**  
ESLint and Biome enforce code style and static analysis. arbiter enforces governance conventions — commit format, TODO policy, file structure rules, AI agent constraints — that static analysis tools do not cover. arbiter also generates the config for those tools as part of its output.

---

**What is a hook in arbiter?**  
A hook is a script that Claude Code (or another supported agent) runs automatically in response to events: before editing a file, after a commit, on tool failure. arbiter generates and wires these hooks. See [docs/REFERENCE/HOOKS.md](REFERENCE/HOOKS.md).

---

**Can I customize the generated AGENTS.md?**  
Yes. The generated file has custom-content zones that survive `arbiter update`. You can also add custom invariants via the plugin API.

---

**What is the plugin API?**  
arbiter supports plugins that add invariants, templates, hooks, and archetypes. See the plugin API docs (issue #603 — in progress).

---

**How do I add a custom invariant?**  
See the custom invariant recipe (issue #646 — in progress).

---

**Does arbiter make performance guarantees?**  
Hook latency benchmarks are tracked. Typical hook execution is under 300ms. Gate checks (L1) run in under 30 seconds for most projects.

---

**Is arbiter commercially licensable?**  
arbiter is released under the Apache 2.0 license. Commercial use is permitted. See [LICENSE](../LICENSE).

---

**What is the contribution process?**  
See [CONTRIBUTING.md](../CONTRIBUTING.md). All PRs require a changeset file or an explicit no-changeset justification. The gate must pass before merge.

---

**Does arbiter measure or guarantee a reduction in bugs or review time?**  
No. arbiter makes no quantitative ROI claims. See [POSITIONING.md](POSITIONING.md) for the full rationale and [How to Measure arbiter Value Yourself](PRODUCT/MEASUREMENT-GUIDE.md) for a neutral methodology if you want to track it.

---

---

**How do I check if my arbiter environment is healthy?**  
Run `arbiter doctor` (no subcommand). It checks Node.js version (>= 22), git availability, AGENTS.md presence, and hooks path configuration. Outputs a PASS/WARN/FAIL table; exits 0 unless a check FAILs. Use `--json` for machine-readable output.

---

**How do I look up what an error code, INV rule, or CANON rule means?**  
Run `arbiter explain <code>`, e.g. `arbiter explain INV-04` or `arbiter explain CANON-06` or `arbiter explain E_CONFIG_NOT_FOUND`. Use `arbiter explain --list` to see all known codes grouped by category.

---

_For deeper questions, open a GitHub Discussion or file an issue._
