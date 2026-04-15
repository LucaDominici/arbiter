import { describe, it, expect } from "vitest";
import {
  parseNodeVersion,
  parseNpmVersion,
  parseJavaVersion,
  parseGradleVersion,
  parseMavenVersion,
  parseRustVersion,
  parseCargoVersion,
  parseGoVersion,
  parsePythonVersion,
  parsePipVersion,
} from "../../src/compatibility/parsers.js";

describe("parseNodeVersion", () => {
  it("parses standard semver output", () => {
    expect(parseNodeVersion("v20.11.1\n")).toEqual({
      major: 20,
      minor: 11,
      patch: 1,
    });
  });
  it("parses without trailing newline", () => {
    expect(parseNodeVersion("v18.0.0")).toEqual({
      major: 18,
      minor: 0,
      patch: 0,
    });
  });
  it("returns null for empty string", () => {
    expect(parseNodeVersion("")).toBeNull();
  });
  it("returns null for garbage", () => {
    expect(parseNodeVersion("not a version")).toBeNull();
  });
});

describe("parseNpmVersion", () => {
  it("parses npm --version output", () => {
    expect(parseNpmVersion("10.2.4\n")).toEqual({
      major: 10,
      minor: 2,
      patch: 4,
    });
  });
  it("returns null for empty", () => {
    expect(parseNpmVersion("")).toBeNull();
  });
});

describe("parseJavaVersion", () => {
  it("parses modern openjdk", () => {
    expect(parseJavaVersion('openjdk version "17.0.9" 2023-10-17\n')).toEqual({
      major: 17,
      minor: 0,
      patch: 9,
    });
  });
  it("parses java version line", () => {
    expect(parseJavaVersion('java version "21.0.1" 2023-10-17\n')).toEqual({
      major: 21,
      minor: 0,
      patch: 1,
    });
  });
  it("parses legacy 1.8 format", () => {
    expect(parseJavaVersion('java version "1.8.0_402"\njava ...')).toEqual({
      major: 8,
      minor: 0,
      patch: 402,
    });
  });
  it("returns null for empty", () => {
    expect(parseJavaVersion("")).toBeNull();
  });
});

describe("parseGradleVersion", () => {
  it("parses Gradle version output", () => {
    expect(parseGradleVersion("Gradle 8.5\n")).toEqual({
      major: 8,
      minor: 5,
      patch: 0,
    });
  });
  it("parses with patch", () => {
    expect(parseGradleVersion("Gradle 7.6.4\n")).toEqual({
      major: 7,
      minor: 6,
      patch: 4,
    });
  });
  it("returns null for empty", () => {
    expect(parseGradleVersion("")).toBeNull();
  });
});

describe("parseMavenVersion", () => {
  it("parses Apache Maven output", () => {
    expect(
      parseMavenVersion(
        "Apache Maven 3.9.6 (bc0240f3c744dd6b6ec2920b3cd08dcc921f13e9)\n",
      ),
    ).toEqual({ major: 3, minor: 9, patch: 6 });
  });
  it("returns null for empty", () => {
    expect(parseMavenVersion("")).toBeNull();
  });
});

describe("parseRustVersion", () => {
  it("parses rustc --version", () => {
    expect(parseRustVersion("rustc 1.78.0 (9b00956e5 2024-04-29)\n")).toEqual({
      major: 1,
      minor: 78,
      patch: 0,
    });
  });
  it("returns null for empty", () => {
    expect(parseRustVersion("")).toBeNull();
  });
});

describe("parseCargoVersion", () => {
  it("parses cargo --version", () => {
    expect(parseCargoVersion("cargo 1.78.0 (54d8815d0 2024-03-26)\n")).toEqual({
      major: 1,
      minor: 78,
      patch: 0,
    });
  });
  it("returns null for empty", () => {
    expect(parseCargoVersion("")).toBeNull();
  });
});

describe("parseGoVersion", () => {
  it("parses go version output", () => {
    expect(parseGoVersion("go version go1.22.3 linux/amd64\n")).toEqual({
      major: 1,
      minor: 22,
      patch: 3,
    });
  });
  it("returns null for empty", () => {
    expect(parseGoVersion("")).toBeNull();
  });
});

describe("parsePythonVersion", () => {
  it("parses Python 3.x", () => {
    expect(parsePythonVersion("Python 3.12.3\n")).toEqual({
      major: 3,
      minor: 12,
      patch: 3,
    });
  });
  it("returns null for empty", () => {
    expect(parsePythonVersion("")).toBeNull();
  });
});

describe("parsePipVersion", () => {
  it("parses pip version output", () => {
    expect(
      parsePipVersion(
        "pip 24.0 from /usr/lib/python3/dist-packages/pip (python 3.12)\n",
      ),
    ).toEqual({ major: 24, minor: 0, patch: 0 });
  });
  it("returns null for empty", () => {
    expect(parsePipVersion("")).toBeNull();
  });
});
