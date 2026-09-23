import { describe, expect, it } from "vitest";

import {
  assertCleanWorkingTree,
  bumpSemver,
  componentPackagePath,
} from "../../../scripts/bump-version.mjs";

describe("release versioning", () => {
  it("bumps patch, minor, and major versions", () => {
    expect(bumpSemver("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpSemver("0.1.9", "minor")).toBe("0.2.0");
    expect(bumpSemver("0.9.4", "major")).toBe("1.0.0");
  });

  it("rejects unsupported bump kinds and non-plain SemVer versions", () => {
    expect(() => bumpSemver("0.1.0", "banana")).toThrow("Invalid bump");
    expect(() => bumpSemver("0.1", "patch")).toThrow("not a plain SemVer");
    expect(() => bumpSemver("0.1.0-beta.1", "patch")).toThrow(
      "not a plain SemVer",
    );
  });

  it("resolves only independently released application components", () => {
    expect(componentPackagePath("web")).toBe("apps/web/package.json");
    expect(componentPackagePath("coordinator")).toBe(
      "apps/coordinator/package.json",
    );
    expect(() => componentPackagePath("document")).toThrow(
      "Invalid component",
    );
  });

  it("requires a clean working tree", () => {
    expect(() => assertCleanWorkingTree("")).not.toThrow();
    expect(() =>
      assertCleanWorkingTree(" M apps/web/package.json\n"),
    ).toThrow("Working tree is not clean");
  });
});
