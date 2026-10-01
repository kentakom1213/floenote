import { describe, expect, it } from "vitest";

import { interpolatePreviewScrollTop } from "../src/split-scroll-sync.js";

describe("split preview scroll sync", () => {
  it("interpolates within a source block", () => {
    const anchors = [
      { sourceStart: 1, sourceEnd: 5, top: 0, bottom: 120 },
      { sourceStart: 5, sourceEnd: 10, top: 160, bottom: 360 },
    ];

    expect(interpolatePreviewScrollTop(anchors, 3, 1000)).toBe(80);
    expect(interpolatePreviewScrollTop(anchors, 7, 1000)).toBe(240);
  });

  it("interpolates across blank source lines between blocks", () => {
    const anchors = [
      { sourceStart: 1, sourceEnd: 2, top: 0, bottom: 40 },
      { sourceStart: 5, sourceEnd: 6, top: 160, bottom: 200 },
    ];

    expect(interpolatePreviewScrollTop(anchors, 3, 1000)).toBe(80);
    expect(interpolatePreviewScrollTop(anchors, 4, 1000)).toBe(120);
  });

  it("clamps the target to the preview scroll range", () => {
    const anchors = [
      { sourceStart: 1, sourceEnd: 2, top: 0, bottom: 40 },
      { sourceStart: 10, sourceEnd: 20, top: 900, bottom: 1200 },
    ];

    expect(interpolatePreviewScrollTop(anchors, 15, 700)).toBe(700);
  });
});
