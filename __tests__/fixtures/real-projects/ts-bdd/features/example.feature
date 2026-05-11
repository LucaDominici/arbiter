Feature: Example BDD scenario

  Scenario: Valid input succeeds
    Given a valid input
    When the operation is executed
    Then the result is successful

  Scenario: Invalid input returns error
    Given an invalid input
    When the operation is executed
    Then an error is returned
