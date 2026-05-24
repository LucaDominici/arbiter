Feature: arbiter CLI — core surface
  As a developer adopting arbiter
  I want the CLI to respond predictably
  So that I can trust the tool in automation

  Scenario: --version prints a semver string
    When I run "arbiter --version"
    Then the exit code is 0
    And stdout matches semver format

  Scenario: --help prints usage
    When I run "arbiter --help"
    Then the exit code is 0
    And stdout contains "Usage: arbiter"

  Scenario: init creates arbiter.json in a clean project
    Given a clean TypeScript project directory
    When I run "arbiter init --yes --level L1 --tools claude --no-verify"
    Then the exit code is 0
    And "arbiter.json" exists in the project directory

  Scenario: init --dry-run does not create arbiter.json
    Given a clean TypeScript project directory
    When I run "arbiter init --yes --level L1 --tools claude --dry-run --no-verify"
    Then the exit code is 0
    And "arbiter.json" does not exist in the project directory

  @deliberate-fail
  Scenario: deliberate-fail sentinel
    When I run "arbiter --version"
    Then the exit code is 999
