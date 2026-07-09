// Example of Given/When/Then behavioral test structure for Go.
//
// Pattern: use t.Run() with "given X / when Y / then Z" names.
// This makes test output readable and allows -run flag filtering.
package example_test

import (
	"strings"
	"testing"
)

func TestExampleSubject(t *testing.T) {
	t.Run("given a valid input / when processed / then returns uppercase", func(t *testing.T) {
		// Arrange
		input := "hello"

		// Act
		result := strings.ToUpper(input)

		// Assert
		if result != "HELLO" {
			t.Errorf("expected HELLO, got %s", result)
		}
	})

	t.Run("given a valid input / when trimmed and processed / then transforms correctly", func(t *testing.T) {
		// Arrange
		input := "  hello  "

		// Act
		result := strings.ToUpper(strings.TrimSpace(input))

		// Assert
		if result != "HELLO" {
			t.Errorf("expected HELLO, got %s", result)
		}
	})

	t.Run("given an empty input / when processed / then returns empty string", func(t *testing.T) {
		// Arrange
		input := ""

		// Act
		result := strings.ToUpper(input)

		// Assert
		if result != "" {
			t.Errorf("expected empty, got %s", result)
		}
	})
}
