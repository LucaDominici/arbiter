"""BDD tests using pytest-bdd — binds to features/example.feature."""
import pytest
from pytest_bdd import scenarios, given, when, then

scenarios("features/example.feature")


@given("a valid input", target_fixture="context")
def valid_input():
    return {"input": "valid", "result": None, "error": None}


@given("an invalid input", target_fixture="context")
def invalid_input():
    return {"input": "invalid", "result": None, "error": None}


@when("the operation is executed")
def execute_operation(context):
    if context["input"] == "valid":
        context["result"] = "success"
        context["error"] = None
    else:
        context["result"] = ""
        context["error"] = "invalid input"


@then("the result is successful")
def result_is_successful(context):
    assert context["result"] == "success"
    assert context["error"] is None


@then("an error is returned")
def error_is_returned(context):
    assert context["error"], "Expected an error but got none"
