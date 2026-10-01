import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { collectLiveMarkdownBlocks } from "../src/live-markdown-blocks.js";

function blocks(source: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [markdown()],
  });
  return collectLiveMarkdownBlocks(state).map((block) => ({
    source: state.sliceDoc(block.from, block.to),
    kind: block.kind,
  }));
}

describe("live Markdown blocks", () => {
  it("collects supported top-level Markdown blocks", () => {
    expect(
      blocks([
        "# Heading",
        "",
        "A **paragraph**.",
        "",
        "~~~ts",
        "const value = 1;",
        "~~~",
      ].join("\n")),
    ).toEqual([
      { source: "# Heading", kind: "heading" },
      { source: "A **paragraph**.", kind: "paragraph" },
      {
        source: "~~~ts\nconst value = 1;\n~~~",
        kind: "code",
      },
    ]);
  });


  it("treats each top-level list item as one block", () => {
    expect(
      blocks([
        "- first",
        "  - nested",
        "- second",
        "",
        "1. ordered",
        "2. list",
      ].join("\n")),
    ).toEqual([
      {
        source: "- first\n  - nested",
        kind: "list",
      },
      {
        source: "- second",
        kind: "list",
      },
      {
        source: "1. ordered",
        kind: "list",
      },
      {
        source: "2. list",
        kind: "list",
      },
    ]);
  });

  it("treats display math as one block", () => {
    expect(
      blocks([
        "Before",
        "",
        "$$",
        "x^2 + y^2",
        "$$",
        "",
        "After",
      ].join("\n")),
    ).toEqual([
      { source: "Before", kind: "paragraph" },
      { source: "$$\nx^2 + y^2\n$$", kind: "math" },
      { source: "After", kind: "paragraph" },
    ]);
  });

  it("does not interpret dollar fences inside fenced code as math", () => {
    expect(
      blocks([
        "~~~text",
        "$$",
        "not math",
        "$$",
        "~~~",
      ].join("\n")),
    ).toEqual([
      {
        source: "~~~text\n$$\nnot math\n$$\n~~~",
        kind: "code",
      },
    ]);
  });
});
