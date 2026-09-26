import { NoteProject } from "@floe-note/document";
import { describe, expect, it } from "vitest";

import {
  RANDOM_TAG_COLORS,
  assignRandomTagColorIfMissing,
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

  it("assigns a random color only when no Project color exists", () => {
    const project = NoteProject.create();

    const assigned = assignRandomTagColorIfMissing(project, "research", () => 0);

    expect(assigned).toBe(RANDOM_TAG_COLORS[0]);
    expect(project.getTagColor("research")).toBe(RANDOM_TAG_COLORS[0]);

    project.setTagColor("research", "purple");
    const reused = assignRandomTagColorIfMissing(project, "research", () => 0.5);

    expect(reused).toBeNull();
    expect(project.getTagColor("research")).toBe("purple");
  });
});
