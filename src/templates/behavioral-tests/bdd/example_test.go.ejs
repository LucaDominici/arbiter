//go:build bdd
// +build bdd

// BDD suite — guarded by the `bdd` build tag so the unresolved
// github.com/cucumber/godog import does NOT break the default build. The
// generated gate runs it explicitly with `go test -tags bdd ./internal/bdd/...`
// (see scripts/check-all.mjs), while `go vet/test/staticcheck ./...`, coverage
// and complexity all skip it cleanly until the dependency is wired. Mirrors the
// Python suite's `pytest.importorskip("pytest_bdd")` graceful-skip pattern.
package bdd_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/cucumber/godog"
)

type exampleState struct {
	input  string
	result string
	err    error
}

func (s *exampleState) aValidInput(ctx context.Context) (context.Context, error) {
	s.input = "valid"
	s.err = nil
	return ctx, nil
}

func (s *exampleState) anInvalidInput(ctx context.Context) (context.Context, error) {
	s.input = "invalid"
	s.err = nil
	return ctx, nil
}

func (s *exampleState) theOperationIsExecuted(ctx context.Context) (context.Context, error) {
	if s.input == "valid" {
		s.result = "success"
	} else {
		s.result = ""
		s.err = fmt.Errorf("invalid input")
	}
	return ctx, nil
}

func (s *exampleState) theResultIsSuccessful(ctx context.Context) (context.Context, error) {
	if s.result != "success" {
		return ctx, fmt.Errorf("expected success, got %q", s.result)
	}
	return ctx, nil
}

func (s *exampleState) anErrorIsReturned(ctx context.Context) (context.Context, error) {
	if s.err == nil {
		return ctx, fmt.Errorf("expected an error but got none")
	}
	return ctx, nil
}

func InitializeScenario(ctx *godog.ScenarioContext) {
	s := &exampleState{}
	ctx.Step(`^a valid input$`, s.aValidInput)
	ctx.Step(`^an invalid input$`, s.anInvalidInput)
	ctx.Step(`^the operation is executed$`, s.theOperationIsExecuted)
	ctx.Step(`^the result is successful$`, s.theResultIsSuccessful)
	ctx.Step(`^an error is returned$`, s.anErrorIsReturned)
}

func TestSuite(t *testing.T) {
	suite := godog.TestSuite{
		Name:                "example",
		ScenarioInitializer: InitializeScenario,
		Options:             &godog.Options{Format: "pretty", Paths: []string{"../../features"}},
	}
	if suite.Run() != 0 {
		t.Fatal("BDD scenarios failed")
	}
}
