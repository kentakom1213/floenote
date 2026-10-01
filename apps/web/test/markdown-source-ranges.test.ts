/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../src/MarkdownPreview.js";
import {
  annotateMarkdownSourceRanges,
  markdownBlockEditorText,
  markdownBlockSourceText,
  readMarkdownSourceBlock,
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

    expect(
      readMarkdownSourceBlock(document.body.querySelector("h1")!),
    ).toMatchObject({
      kind: "heading",
    });
    expect(
      readMarkdownSourceBlock(document.body.querySelector("p")!),
    ).toMatchObject({
      kind: "paragraph",
    });
  });

  it("separates list item content from its marker and subtree", () => {
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

    expect(blocks.map((block) => sourceFor(block, source))).toEqual([
      "parent",
      "child",
      "grandchild",
      "sibling",
      "second",
    ]);

    const parent = readMarkdownSourceBlock(blocks[0]!);
    const child = readMarkdownSourceBlock(blocks[1]!);
    expect(parent).toMatchObject({
      kind: "list-item",
      listIndent: "",
      listMarker: "-",
      firstChildAt: source.indexOf("  - child"),
      childIndent: "  ",
      childMarker: "-",
    });
    expect(child).toMatchObject({
      kind: "list-item",
      listIndent: "  ",
      listMarker: "-",
      firstChildAt: source.indexOf("    - grandchild"),
      childIndent: "    ",
      childMarker: "-",
    });
    expect(
      parent
        ? source.slice(parent.subtreeFrom, parent.subtreeTo).trimStart()
        : null,
    ).toBe(
      ["- parent", "  - child", "    - grandchild", "  - sibling"].join(
        "\n",
      ),
    );
    expect(
      child
        ? source.slice(child.subtreeFrom, child.subtreeTo).trimStart()
        : null,
    ).toBe(["- child", "    - grandchild"].join("\n"));

    expect(document.body.querySelectorAll("li")).toHaveLength(5);
    expect(document.body.querySelectorAll("ul")).toHaveLength(3);
  });

  it("maps multiline list content as one editable block", () => {
    const source = [
      "- first line",
      "  second line",
      "  third line",
      "  - child",
      "- next",
    ].join("\n");
    const document = new DOMParser().parseFromString(
      renderMarkdown(source),
      "text/html",
    );

    annotateMarkdownSourceRanges(document, source);

    const parentElement = document.body.querySelector(
      ".markdown-live-list-item-content",
    );
    if (!parentElement) throw new Error("Expected parent list block");

    const parent = readMarkdownSourceBlock(parentElement);
    if (!parent) throw new Error("Expected parent source block");

    expect(source.slice(parent.from, parent.to)).toBe(
      ["first line", "  second line", "  third line"].join("\n"),
    );
    expect(markdownBlockEditorText(source, parent)).toBe(
      ["first line", "second line", "third line"].join("\n"),
    );
    expect(
      markdownBlockSourceText(
        ["renamed", "continued", "again"].join("\n"),
        parent,
      ),
    ).toBe(["renamed", "  continued", "  again"].join("\n"));
    expect(parent.firstChildAt).toBe(source.indexOf("  - child"));
  });
});

function sourceFor(element: Element | null, source: string): string | null {
  if (!element) return null;
  const range = readMarkdownSourceRange(element);
  return range ? source.slice(range.from, range.to) : null;
}
