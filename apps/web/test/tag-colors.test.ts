import { describe, expect, it } from "vitest";

import {
  RANDOM_TAG_COLORS,
  pickRandomTagColor,
} from "../src/tag-colors.js";

describe("tag color assignment", () => {
  it("excludes gray from automatically assigned colors", () => {
    expect(RANDOM_TAG_COLORS).not.toContain("gray");
    expect(RANDOM_TAG_COLORS).toHaveLength(9);
  });

  it("maps the random source into the fixed non-gray palette", () => {
    expect(pickRandomTagColor(() => 0)).toBe(RANDOM_TAG_COLORS[0]);
    expect(pickRandomTagColor(() => 0.999999)).toBe(
      RANDOM_TAG_COLORS[RANDOM_TAG_COLORS.length - 1],
    );
  });
});
