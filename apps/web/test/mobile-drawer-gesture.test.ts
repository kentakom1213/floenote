import { describe, expect, it } from "vitest";

import {
  isHorizontalMobileDrawerSwipe,
  shouldCompleteMobileDrawerSwipe,
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
