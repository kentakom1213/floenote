import { describe, expect, it } from "vitest";

import {
  interpolatePreviewScrollTop,
  interpolateSourceLine,
} from "../src/split-scroll-sync.js";

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

  it("maps preview positions back to source lines", () => {
    const anchors = [
      { sourceStart: 1, sourceEnd: 5, top: 0, bottom: 120 },
      { sourceStart: 5, sourceEnd: 10, top: 160, bottom: 360 },
    ];

    expect(interpolateSourceLine(anchors, 80)).toBe(3);
    expect(interpolateSourceLine(anchors, 240)).toBe(7);
  });

  it("round-trips representative source and preview positions", () => {
    const anchors = [
      { sourceStart: 1, sourceEnd: 5, top: 0, bottom: 120 },
      { sourceStart: 5, sourceEnd: 10, top: 160, bottom: 360 },
    ];

    for (const line of [1, 3, 5, 7, 10]) {
      const top = interpolatePreviewScrollTop(anchors, line, 1000);
      expect(interpolateSourceLine(anchors, top)).toBe(line);
    }
  });

});
