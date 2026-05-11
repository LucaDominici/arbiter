import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";

interface ExampleWorld {
  input: string;
  result: string;
  error: string | null;
}

Given("a valid input", function (this: ExampleWorld) {
  this.input = "valid";
  this.error = null;
});

Given("an invalid input", function (this: ExampleWorld) {
  this.input = "invalid";
  this.error = null;
});

When("the operation is executed", function (this: ExampleWorld) {
  if (this.input === "valid") {
    this.result = "success";
    this.error = null;
  } else {
    this.result = "";
    this.error = "invalid input";
  }
});

Then("the result is successful", function (this: ExampleWorld) {
  assert.equal(this.result, "success");
  assert.equal(this.error, null);
});

Then("an error is returned", function (this: ExampleWorld) {
  assert.ok(this.error, "Expected an error but got none");
});
