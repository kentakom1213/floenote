import { marked } from "marked";

const SOURCE_FROM_ATTRIBUTE = "data-floe-source-from";
const SOURCE_TO_ATTRIBUTE = "data-floe-source-to";

export function annotateMarkdownSourceRanges(
  document: Document,
  source: string,
): void {
  const tokens = marked.lexer(source, { gfm: true });
  const children = Array.from(document.body.children);
  let childIndex = 0;
  let sourceOffset = 0;

  for (const token of tokens) {
    const raw = token.raw ?? "";
    const from = sourceOffset;
    const to = trimTrailingLineBreaks(source, from, from + raw.length);
    sourceOffset += raw.length;

    const tagName = renderedTagName(token);
    if (!tagName || to <= from) continue;

    while (
      childIndex < children.length &&
      children[childIndex]?.tagName.toLowerCase() !== tagName
    ) {
      childIndex += 1;
    }

    const element = children[childIndex] as HTMLElement | undefined;
    if (!element) break;

    setSourceRange(element, from, to);

    if (token.type === "list") {
      annotateTopLevelListItems(element, token.raw, token.items, from, source);
    }

    childIndex += 1;
  }
}

export function readMarkdownSourceRange(
  element: Element,
): { from: number; to: number } | null {
  const from = Number(element.getAttribute(SOURCE_FROM_ATTRIBUTE));
  const to = Number(element.getAttribute(SOURCE_TO_ATTRIBUTE));
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from) {
    return null;
  }
  return { from, to };
}

function annotateTopLevelListItems(
  listElement: HTMLElement,
  listRaw: string,
  items: readonly { raw: string }[],
  listFrom: number,
  source: string,
): void {
  const elements = Array.from(listElement.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "LI",
  );
  let searchOffset = 0;

  items.forEach((item, index) => {
    const relativeFrom = listRaw.indexOf(item.raw, searchOffset);
    if (relativeFrom < 0) return;

    const from = listFrom + relativeFrom;
    const to = trimTrailingLineBreaks(source, from, from + item.raw.length);
    const element = elements[index];
    if (element && to > from) {
      setSourceRange(element, from, to);
    }

    searchOffset = relativeFrom + item.raw.length;
  });
}

function setSourceRange(element: HTMLElement, from: number, to: number): void {
  element.setAttribute(SOURCE_FROM_ATTRIBUTE, String(from));
  element.setAttribute(SOURCE_TO_ATTRIBUTE, String(to));
}

function trimTrailingLineBreaks(
  source: string,
  from: number,
  end: number,
): number {
  let to = Math.min(end, source.length);
  while (to > from && (source[to - 1] === "\n" || source[to - 1] === "\r")) {
    to -= 1;
  }
  return to;
}

function renderedTagName(
  token: ReturnType<typeof marked.lexer>[number],
): string | null {
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
