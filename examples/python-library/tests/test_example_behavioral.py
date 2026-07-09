"""
Example of Given/When/Then behavioral test structure using pytest.

Pattern: class groups by context (given X); method names describe
the behaviour (when_Y_then_Z). pytest discovers test_ prefixed methods.
"""


class TestGivenValidInput:
    def test_when_processed_then_returns_uppercase(self) -> None:
        # Arrange
        input_value = "hello"

        # Act
        result = input_value.upper()

        # Assert
        assert result == "HELLO"

    def test_when_stripped_and_processed_then_transforms_correctly(self) -> None:
        # Arrange
        input_value = "  hello  "

        # Act
        result = input_value.strip().upper()

        # Assert
        assert result == "HELLO"


class TestGivenEmptyInput:
    def test_when_processed_then_returns_empty_string(self) -> None:
        # Arrange
        input_value = ""

        # Act
        result = input_value.upper()

        # Assert
        assert result == ""
