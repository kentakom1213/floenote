import { describe, expect, it } from "vitest";

import {
  getMobileDrawerOpenRegionWidth,
  isHorizontalMobileDrawerSwipe,
  shouldCompleteMobileDrawerSwipe,
  shouldStartMobileDrawerOpenSwipe,
  type MobileDrawerSwipe,
} from "../src/mobile-drawer-gesture.js";

function swipe(
  direction: MobileDrawerSwipe["direction"],
): MobileDrawerSwipe {
  return {
    direction,
    startX: direction === "open" ? 8 : 280,
    startY: 200,
  };
}

describe("mobile drawer swipe gesture", () => {
  it("uses 15% of the viewport for the open gesture, capped at 64px", () => {
    expect(getMobileDrawerOpenRegionWidth(360)).toBe(54);
    expect(getMobileDrawerOpenRegionWidth(390)).toBe(58.5);
    expect(getMobileDrawerOpenRegionWidth(412)).toBeCloseTo(61.8);
    expect(getMobileDrawerOpenRegionWidth(600)).toBe(64);
  });

  it("starts an open swipe only inside the mobile left-edge region", () => {
    expect(shouldStartMobileDrawerOpenSwipe(60, 412)).toBe(true);
    expect(shouldStartMobileDrawerOpenSwipe(63, 412)).toBe(false);
    expect(shouldStartMobileDrawerOpenSwipe(20, 1024)).toBe(false);
    expect(shouldStartMobileDrawerOpenSwipe(-1, 412)).toBe(false);
  });

  it("opens for a deliberate left-edge swipe to the right", () => {
    expect(
      shouldCompleteMobileDrawerSwipe(swipe("open"), 80, 208),
    ).toBe(true);
  });

  it("closes for a deliberate drawer swipe to the left", () => {
    expect(
      shouldCompleteMobileDrawerSwipe(swipe("close"), 210, 206),
    ).toBe(true);
  });

  it("ignores short horizontal movement", () => {
    expect(
      shouldCompleteMobileDrawerSwipe(swipe("open"), 42, 202),
    ).toBe(false);
  });

  it("ignores predominantly vertical scrolling", () => {
    expect(
      shouldCompleteMobileDrawerSwipe(swipe("open"), 62, 280),
    ).toBe(false);
  });

  it("detects horizontal intent before preventing native vertical scrolling", () => {
    const candidate = swipe("open");

    expect(isHorizontalMobileDrawerSwipe(candidate, 14, 230)).toBe(false);
    expect(isHorizontalMobileDrawerSwipe(candidate, 30, 205)).toBe(true);
  });
});
