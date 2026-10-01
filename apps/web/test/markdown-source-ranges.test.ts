/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../src/MarkdownPreview.js";
import {
  annotateMarkdownSourceRanges,
  readMarkdownSourceRange,
} from "../src/markdown-source-ranges.js";

describe("Markdown source ranges", () => {
  it("maps rendered top-level blocks and list items back to source", () => {
    const source = [
      "# Heading",
      "",
      "Paragraph.",
      "",
      "1. first",
      "   - nested",
      "2. second",
    ].join("\n");
    const document = new DOMParser().parseFromString(
      renderMarkdown(source),
      "text/html",
    );

    annotateMarkdownSourceRanges(document, source);

    const heading = document.body.querySelector("h1");
    const paragraph = document.body.querySelector("p");
    const list = document.body.querySelector("ol");
    const items = Array.from(document.body.querySelectorAll(":scope > ol > li"));

    expect(sourceFor(heading, source)).toBe("# Heading");
    expect(sourceFor(paragraph, source)).toBe("Paragraph.");
    expect(sourceFor(list, source)).toContain("1. first");
    expect(items.map((item) => sourceFor(item, source))).toEqual([
      "1. first\n   - nested",
      "2. second",
    ]);
  });
});

function sourceFor(element: Element | null, source: string): string | null {
  if (!element) return null;
  const range = readMarkdownSourceRange(element);
  return range ? source.slice(range.from, range.to) : null;
}
