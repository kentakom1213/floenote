import { describe, expect, it } from "vitest";

import {
  actionRequiresSecureDevice,
  deriveEntrySurface,
} from "../src/onboarding-state.js";

describe("onboarding entry state", () => {
  it("keeps the checking state from flashing onboarding", () => {
    expect(deriveEntrySurface("checking", false)).toBe("checking");
  });

  it("routes a missing Vault to onboarding", () => {
    expect(deriveEntrySurface("missing", false)).toBe("onboarding");
  });

  it("keeps returning locked devices on the unlock gate", () => {
    expect(deriveEntrySurface("locked", false)).toBe("unlock");
    expect(deriveEntrySurface("unlocking", false)).toBe("unlock");
    expect(deriveEntrySurface("error", false)).toBe("unlock");
  });

  it("routes an unlocked empty device to onboarding", () => {
    expect(deriveEntrySurface("unlocked", false)).toBe("onboarding");
  });

  it("routes an unlocked device with a Workspace to the workspace", () => {
    expect(deriveEntrySurface("unlocked", true)).toBe("workspace");
  });

  it("requires security only for first-time create/import actions", () => {
    for (const action of ["create", "import-floe", "import-markdown"] as const) {
      expect(actionRequiresSecureDevice(action, "missing")).toBe(true);
      expect(actionRequiresSecureDevice(action, "unlocked")).toBe(false);
    }
  });
});
