Feature: Example feature
  As a user of python-library
  I want to see a working BDD example
  So that I can extend it with real scenarios

  Scenario: Successful operation
    Given a valid input
    When the operation is executed
    Then the result is successful

  Scenario: Invalid input is rejected
    Given an invalid input
    When the operation is executed
    Then an error is returned
