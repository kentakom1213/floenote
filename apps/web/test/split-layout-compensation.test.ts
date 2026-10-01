import { describe, expect, it } from "vitest";

import { planHeadingAlignment } from "../src/split-layout-compensation.js";

describe("split layout compensation", () => {
  it("adds space to whichever side reaches a heading first", () => {
    const plan = planHeadingAlignment([
      { sourceLine: 1, editorTop: 100, previewTop: 140 },
      { sourceLine: 20, editorTop: 400, previewTop: 360 },
    ]);

    expect(plan.editor).toEqual([{ line: 1, height: 40 }]);
    expect(plan.preview).toEqual([{ line: 20, height: 80 }]);
  });

  it("carries previous compensation into later headings", () => {
    const plan = planHeadingAlignment([
      { sourceLine: 1, editorTop: 100, previewTop: 150 },
      { sourceLine: 10, editorTop: 300, previewTop: 350 },
    ]);

    expect(plan.editor).toEqual([{ line: 1, height: 50 }]);
    expect(plan.preview).toEqual([]);
  });

  it("caps individual spacers and ignores tiny differences", () => {
    const plan = planHeadingAlignment(
      [
        { sourceLine: 1, editorTop: 100, previewTop: 102 },
        { sourceLine: 10, editorTop: 200, previewTop: 700 },
      ],
      200,
      4,
    );

    expect(plan.editor).toEqual([{ line: 10, height: 200 }]);
    expect(plan.preview).toEqual([]);
  });
});
