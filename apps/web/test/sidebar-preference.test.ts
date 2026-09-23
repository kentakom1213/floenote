import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  normalizeSidebarWidth,
} from "../src/sidebar-preference.js";

describe("sidebar preference", () => {
  it("keeps widths inside the supported range", () => {
    expect(normalizeSidebarWidth(300)).toBe(300);
  });

  it("clamps widths to the supported range", () => {
    expect(normalizeSidebarWidth(MIN_SIDEBAR_WIDTH - 100)).toBe(
      MIN_SIDEBAR_WIDTH,
    );
    expect(normalizeSidebarWidth(MAX_SIDEBAR_WIDTH + 100)).toBe(
      MAX_SIDEBAR_WIDTH,
    );
  });

  it("falls back to the default for invalid values", () => {
    expect(normalizeSidebarWidth(undefined)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(normalizeSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});
