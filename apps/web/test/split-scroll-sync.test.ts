import { describe, expect, it } from "vitest";

import {
  interpolatePreviewScrollTop,
  interpolateSourcePositionFromPreviewScrollTop,
} from "../src/split-scroll-sync.js";

describe("split preview scroll sync", () => {
  it("interpolates between source-mapped preview blocks", () => {
    const anchors = [
      { sourceStart: 1, sourceEnd: 3, top: 12 },
      { sourceStart: 5, sourceEnd: 8, top: 180 },
      { sourceStart: 10, sourceEnd: 14, top: 420 },
    ];

    expect(interpolatePreviewScrollTop(anchors, 3, 700)).toBe(90);
    expect(interpolatePreviewScrollTop(anchors, 7.5, 700)).toBe(300);
  });

  it("maps preview scroll back to the same source position", () => {
    const anchors = [
      { sourceStart: 1, sourceEnd: 3, top: 12 },
      { sourceStart: 5, sourceEnd: 8, top: 180 },
      { sourceStart: 10, sourceEnd: 14, top: 420 },
    ];

    expect(
      interpolateSourcePositionFromPreviewScrollTop(anchors, 90, 700),
    ).toBe(3);
    expect(
      interpolateSourcePositionFromPreviewScrollTop(anchors, 300, 700),
    ).toBe(7.5);
  });

  it("pins the start and end of the document to the scroll range", () => {
    const anchors = [
      { sourceStart: 1, sourceEnd: 3, top: 20 },
      { sourceStart: 5, sourceEnd: 10, top: 400 },
    ];

    expect(interpolatePreviewScrollTop(anchors, 1, 600)).toBe(0);
    expect(interpolatePreviewScrollTop(anchors, 10, 600)).toBe(600);
    expect(interpolatePreviewScrollTop(anchors, 100, 600)).toBe(600);
    expect(
      interpolateSourcePositionFromPreviewScrollTop(anchors, 0, 600),
    ).toBe(1);
    expect(
      interpolateSourcePositionFromPreviewScrollTop(anchors, 600, 600),
    ).toBe(10);
  });

  it("does not scroll when the preview has no scroll range", () => {
    const anchors = [{ sourceStart: 1, sourceEnd: 2, top: 12 }];

    expect(interpolatePreviewScrollTop(anchors, 1.5, 0)).toBe(0);
    expect(
      interpolateSourcePositionFromPreviewScrollTop(anchors, 0, 0),
    ).toBe(1);
  });
});
