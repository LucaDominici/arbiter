# Example: go-library

End-to-end walkthrough of `arbiter init` on a Go library module. The starter mirrors the reference fixture at `__tests__/fixtures/real-projects/go-library/`.

## 1. Starter project (before `arbiter init`)

A minimal Go module with a utility package and table-driven tests. Arbiter detects the `library` archetype from the absence of a `main` package and `cmd/` directory.

```
go-library/
├── go.mod                 # module github.com/example/go-library-fixture; go 1.22
├── manifest.json          # { language: "go", archetype: "library", levels: ["L1","L2","L3"] }
├── math.go
└── math_test.go
```

`go.mod` (reference shape):

```
module github.com/example/go-library-fixture

go 1.22
```

## 2. Run `arbiter init`

```bash
npx @arbiter/cli init \
  --dir ./go-library \
  --tools claude \
  --level L2
```

To override detection, pass `--archetype library --language go`.

## 3. Generated artifacts

**Governance contract**

- `AGENTS.md` — canonical rules, invariants, gate command (`go vet`, `golangci-lint run`, `go test ./...`).
- `arbiter.json` — installer config.
- `.arbiter-generated.json` — file manifest.

**Gate scripts**

- `scripts/check-all.mjs` — orchestrator; invokes `go` and `golangci-lint`.
- Invariant-specific check scripts (orphan TODOs, placeholders, etc.).

**Git hooks**

- `.githooks/pre-commit` — `node scripts/check-all.mjs L1`.
- `.githooks/pre-push` — `node scripts/check-all.mjs L2`.

**AI-tool configs**

- `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/`, `.claude/rules/*.md`.

**CI**

- `.github/workflows/ci.yml` — installs Go via `actions/setup-go`, runs L2 gate.
- `.github/workflows/codeql.yml` (L2+) — security analysis.

**Tooling configs**

- `.golangci.yml` — linter config (staticcheck, errcheck, govet enabled by default).
- `.gitleaks.toml`, `.editorconfig`, `commitlint.config.js`.

## 4. Run the gate

```bash
npm install                       # installs git hooks
node scripts/check-all.mjs L1     # go vet + golangci-lint + go test
node scripts/check-all.mjs L2     # L1 + govulncheck + gitleaks
```

Requires Go ≥ 1.22 and `golangci-lint` in PATH. Install golangci-lint via the [official binary installer](https://golangci-lint.run/usage/install/).

## 5. See the enforcement chain fire

Add an unchecked error in `math.go`:

```go
func WriteResult(w io.Writer, result int) {
    fmt.Fprintln(w, result) // errcheck: return value of fmt.Fprintln is not checked
}
```

The `golangci-lint` (errcheck) check fires at L1. Fix by capturing and returning the error:

```go
func WriteResult(w io.Writer, result int) error {
    _, err := fmt.Fprintln(w, result)
    return err
}
```

## 6. Typical follow-up edits

- Add a new exported function. The `pre-edit-plan-anchor.mjs` hook enforces an active task plan.
- Add ADRs in `docs/SYSTEM/DECISIONS.md` for dependency choices.
- Run `govulncheck ./...` manually before any L3 release gate.
