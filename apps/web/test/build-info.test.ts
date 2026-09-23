import { describe, expect, it } from "vitest";

import { parseCoordinatorHealth } from "../src/build-info.js";

describe("parseCoordinatorHealth", () => {
  it("accepts coordinator health build metadata", () => {
    expect(
      parseCoordinatorHealth({
        ok: true,
        version: "0.0.0",
        build: "abc123def456",
      }),
    ).toEqual({
      version: "0.0.0",
      build: "abc123def456",
    });
  });

  it("rejects health responses without build metadata", () => {
    expect(parseCoordinatorHealth({ ok: true })).toBeNull();
    expect(
      parseCoordinatorHealth({
        ok: true,
        version: "0.0.0",
        build: "",
      }),
    ).toBeNull();
  });
});
