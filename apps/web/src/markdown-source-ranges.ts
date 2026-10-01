import { marked } from "marked";

const SOURCE_FROM_ATTRIBUTE = "data-floe-source-from";
const SOURCE_TO_ATTRIBUTE = "data-floe-source-to";

type MarkedToken = ReturnType<typeof marked.lexer>[number];
type MarkedListToken = Extract<MarkedToken, { type: "list" }>;

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

    if (isListToken(token)) {
      annotateListItems(element, token, from, source);
    } else {
      setSourceRange(element, from, to);
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

function annotateListItems(
  listElement: HTMLElement,
  token: MarkedListToken,
  listFrom: number,
  source: string,
): void {
  const itemElements = directListItems(listElement);
  let itemSearchOffset = 0;

  token.items.forEach((item, index) => {
    const relativeItemFrom = token.raw.indexOf(item.raw, itemSearchOffset);
    if (relativeItemFrom < 0) return;

    const itemFrom = listFrom + relativeItemFrom;
    const nestedTokens = item.tokens.filter(isListToken);
    const nestedRanges = nestedTokens
      .map((nested) => {
        const relativeFrom = findNestedRawOffset(item.raw, nested.raw);
        return relativeFrom < 0
          ? null
          : { token: nested, relativeFrom };
      })
      .filter(
        (
          nested,
        ): nested is { token: MarkedListToken; relativeFrom: number } =>
          nested !== null,
      )
      .sort((left, right) => left.relativeFrom - right.relativeFrom);

    const ownEnd =
      nestedRanges[0]?.relativeFrom === undefined
        ? itemFrom + item.raw.length
        : itemFrom + nestedRanges[0].relativeFrom;
    const ownTo = trimTrailingWhitespace(source, itemFrom, ownEnd);

    const itemElement = itemElements[index];
    if (itemElement) {
      const contentElement = wrapListItemOwnContent(itemElement);
      if (contentElement && ownTo > itemFrom) {
        setSourceRange(contentElement, itemFrom, ownTo);
      }

      const nestedElements = directNestedLists(itemElement);
      nestedRanges.forEach((nested, nestedIndex) => {
        const nestedElement = nestedElements[nestedIndex];
        if (!nestedElement) return;

        annotateListItems(
          nestedElement,
          nested.token,
          itemFrom + nested.relativeFrom,
          source,
        );
      });
    }

    itemSearchOffset = relativeItemFrom + item.raw.length;
  });
}

function directListItems(listElement: HTMLElement): HTMLElement[] {
  return Array.from(listElement.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.tagName === "LI",
  );
}

function directNestedLists(itemElement: HTMLElement): HTMLElement[] {
  return Array.from(itemElement.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      (child.tagName === "UL" || child.tagName === "OL"),
  );
}

function wrapListItemOwnContent(
  itemElement: HTMLElement,
): HTMLElement | null {
  const firstNestedList = Array.from(itemElement.children).find(
    (child) => child.tagName === "UL" || child.tagName === "OL",
  );
  const ownNodes: ChildNode[] = [];

  for (const node of Array.from(itemElement.childNodes)) {
    if (node === firstNestedList) break;
    ownNodes.push(node);
  }

  if (
    ownNodes.length === 0 ||
    ownNodes.every(
      (node) => node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim(),
    )
  ) {
    return null;
  }

  const wrapper = itemElement.ownerDocument.createElement("div");
  wrapper.className = "markdown-live-list-item-content";
  itemElement.insertBefore(wrapper, ownNodes[0] ?? firstNestedList ?? null);

  for (const node of ownNodes) {
    wrapper.append(node);
  }

  return wrapper;
}

function findNestedRawOffset(containerRaw: string, nestedRaw: string): number {
  const exact = containerRaw.indexOf(nestedRaw);
  if (exact >= 0) return exact;

  const firstNestedLine =
    nestedRaw.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? "";
  const needle = firstNestedLine.trimStart();
  if (!needle) return -1;

  let lineStart = 0;
  while (lineStart < containerRaw.length) {
    const lineEnd = containerRaw.indexOf("\n", lineStart);
    const end = lineEnd < 0 ? containerRaw.length : lineEnd;
    const line = containerRaw.slice(lineStart, end);
    if (line.trimStart() === needle) {
      return lineStart + (line.length - line.trimStart().length);
    }
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }

  return -1;
}

function isListToken(token: MarkedToken): token is MarkedListToken {
  return token.type === "list";
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

function trimTrailingWhitespace(
  source: string,
  from: number,
  end: number,
): number {
  let to = Math.min(end, source.length);
  while (to > from && /\s/u.test(source[to - 1] ?? "")) {
    to -= 1;
  }
  return to;
}

function renderedTagName(token: MarkedToken): string | null {
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
