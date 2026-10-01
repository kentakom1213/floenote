/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../src/MarkdownPreview.js";
import {
  annotateMarkdownSourceRanges,
  readMarkdownSourceRange,
} from "../src/markdown-source-ranges.js";

describe("Markdown source ranges", () => {
  it("maps rendered top-level blocks back to source", () => {
    const source = ["# Heading", "", "Paragraph."].join("\n");
    const document = new DOMParser().parseFromString(
      renderMarkdown(source),
      "text/html",
    );

    annotateMarkdownSourceRanges(document, source);

    expect(sourceFor(document.body.querySelector("h1"), source)).toBe(
      "# Heading",
    );
    expect(sourceFor(document.body.querySelector("p"), source)).toBe(
      "Paragraph.",
    );
  });

  it("maps each nested list item's own content without including child lists", () => {
    const source = [
      "- parent",
      "  - child",
      "    - grandchild",
      "  - sibling",
      "- second",
    ].join("\n");
    const document = new DOMParser().parseFromString(
      renderMarkdown(source),
      "text/html",
    );

    annotateMarkdownSourceRanges(document, source);

    const blocks = Array.from(
      document.body.querySelectorAll(".markdown-live-list-item-content"),
    );

    expect(
      blocks.map((block) => sourceFor(block, source)?.trimStart()),
    ).toEqual([
      "- parent",
      "- child",
      "- grandchild",
      "- sibling",
      "- second",
    ]);
    expect(document.body.querySelectorAll("li")).toHaveLength(5);
    expect(document.body.querySelectorAll("ul")).toHaveLength(3);
  });
});

function sourceFor(element: Element | null, source: string): string | null {
  if (!element) return null;
  const range = readMarkdownSourceRange(element);
  return range ? source.slice(range.from, range.to) : null;
}
