package fixture_test

import (
	"testing"

	fixture "github.com/example/go-library-fixture"
)

func TestAdd(t *testing.T) {
	if got := fixture.Add(2, 3); got != 5 {
		t.Errorf("Add(2, 3) = %d; want 5", got)
	}
}

func TestMultiply(t *testing.T) {
	if got := fixture.Multiply(3, 4); got != 12 {
		t.Errorf("Multiply(3, 4) = %d; want 12", got)
	}
}
