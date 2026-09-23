import { describe, expect, it } from "vitest";

import { generateDeviceDisplayName } from "../src/device-name.js";

describe("generateDeviceDisplayName", () => {
  it("returns a short neutral two-word name", () => {
    const name = generateDeviceDisplayName();

    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/u);
    expect(name.length).toBeLessThanOrEqual(80);
  });
});
