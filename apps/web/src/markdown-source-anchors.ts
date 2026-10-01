import { marked } from "marked";

type MarkdownBlockAnchor = {
  startLine: number;
  endLine: number;
  tagName: string;
};

export function annotateMarkdownSourceAnchors(
  document: Document,
  source: string,
): void {
  const anchors = collectMarkdownBlockAnchors(source);
  const children = Array.from(document.body.children);
  let childIndex = 0;

  for (const anchor of anchors) {
    while (
      childIndex < children.length &&
      children[childIndex]?.tagName.toLowerCase() !== anchor.tagName
    ) {
      childIndex += 1;
    }

    const element = children[childIndex] as HTMLElement | undefined;
    if (!element) break;

    element.dataset.floeSourceStart = String(anchor.startLine);
    element.dataset.floeSourceEnd = String(anchor.endLine);
    childIndex += 1;
  }
}

function collectMarkdownBlockAnchors(source: string): MarkdownBlockAnchor[] {
  const tokens = marked.lexer(source, { gfm: true });
  const anchors: MarkdownBlockAnchor[] = [];
  let line = 1;

  for (const token of tokens) {
    const raw = token.raw ?? "";
    const nextLine = line + countNewlines(raw);
    const tagName = renderedTagName(token);

    if (tagName) {
      anchors.push({
        startLine: line,
        endLine: Math.max(line + 1, nextLine),
        tagName,
      });
    }

    line = nextLine;
  }

  return anchors;
}

function renderedTagName(token: ReturnType<typeof marked.lexer>[number]): string | null {
  switch (token.type) {
    case "heading":
      return `h${token.depth}`;
    case "paragraph":
    case "text":
      return "p";
    case "code":
      return "pre";
    case "blockquote":
      return "blockquote";
    case "list":
      return token.ordered ? "ol" : "ul";
    case "table":
      return "table";
    case "hr":
      return "hr";
    default:
      return null;
  }
}

function countNewlines(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === "\n") count += 1;
  }
  return count;
}
