import { marked } from "marked";

const SOURCE_FROM_ATTRIBUTE = "data-floe-source-from";
const SOURCE_TO_ATTRIBUTE = "data-floe-source-to";
const SUBTREE_TO_ATTRIBUTE = "data-floe-subtree-to";
const BLOCK_KIND_ATTRIBUTE = "data-floe-block-kind";
const LIST_INDENT_ATTRIBUTE = "data-floe-list-indent";
const LIST_MARKER_ATTRIBUTE = "data-floe-list-marker";

type MarkedToken = ReturnType<typeof marked.lexer>[number];
type MarkedListToken = Extract<MarkedToken, { type: "list" }>;

type SourceCursor = {
  offset: number;
};

export type MarkdownSourceBlock = {
  from: number;
  to: number;
  subtreeTo: number;
  kind: "paragraph" | "heading" | "list-item" | "other";
  listIndent?: string;
  listMarker?: string;
};

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
      annotateListItems(element, token, source, { offset: from });
    } else {
      setSourceBlock(element, {
        from,
        to,
        subtreeTo: to,
        kind: blockKind(token),
      });
    }

    childIndex += 1;
  }
}

export function readMarkdownSourceRange(
  element: Element,
): { from: number; to: number } | null {
  const block = readMarkdownSourceBlock(element);
  return block ? { from: block.from, to: block.to } : null;
}

export function readMarkdownSourceBlock(
  element: Element,
): MarkdownSourceBlock | null {
  const from = Number(element.getAttribute(SOURCE_FROM_ATTRIBUTE));
  const to = Number(element.getAttribute(SOURCE_TO_ATTRIBUTE));
  const subtreeTo = Number(element.getAttribute(SUBTREE_TO_ATTRIBUTE));
  const kind = element.getAttribute(BLOCK_KIND_ATTRIBUTE);

  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    !Number.isSafeInteger(subtreeTo) ||
    to <= from ||
    subtreeTo < to ||
    (kind !== "paragraph" &&
      kind !== "heading" &&
      kind !== "list-item" &&
      kind !== "other")
  ) {
    return null;
  }

  const listIndent = element.getAttribute(LIST_INDENT_ATTRIBUTE);
  const listMarker = element.getAttribute(LIST_MARKER_ATTRIBUTE);

  return {
    from,
    to,
    subtreeTo,
    kind,
    ...(listIndent === null ? {} : { listIndent }),
    ...(listMarker === null ? {} : { listMarker }),
  };
}

function annotateListItems(
  listElement: HTMLElement,
  token: MarkedListToken,
  source: string,
  cursor: SourceCursor,
): void {
  const itemElements = directListItems(listElement);

  token.items.forEach((item, index) => {
    const sourceLine = findNextListItemLine(source, cursor.offset, item.raw);
    const itemElement = itemElements[index];

    if (sourceLine) {
      cursor.offset = sourceLine.next;
      const contentElement = itemElement
        ? wrapListItemOwnContent(itemElement)
        : null;
      if (contentElement) {
        setSourceBlock(contentElement, {
          from: sourceLine.from,
          to: sourceLine.to,
          subtreeTo: findListItemSubtreeTo(
            source,
            sourceLine.next,
            sourceLine.indent.length,
            sourceLine.to,
          ),
          kind: "list-item",
          listIndent: sourceLine.indent,
          listMarker: sourceLine.marker,
        });
      }
    }

    if (!itemElement) return;

    const nestedTokens = item.tokens.filter(isListToken);
    const nestedElements = directNestedLists(itemElement);
    nestedTokens.forEach((nested, nestedIndex) => {
      const nestedElement = nestedElements[nestedIndex];
      if (!nestedElement) return;
      annotateListItems(nestedElement, nested, source, cursor);
    });
  });
}

function findNextListItemLine(
  source: string,
  from: number,
  itemRaw: string,
): {
  from: number;
  to: number;
  next: number;
  indent: string;
  marker: string;
} | null {
  const firstLine = itemRaw.split(/\r?\n/u)[0] ?? "";
  const needle = firstLine.trim();
  if (!needle) return null;

  let lineStart = from;
  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart);
    const rawEnd = newline < 0 ? source.length : newline;
    const lineEnd =
      rawEnd > lineStart && source[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
    const line = source.slice(lineStart, lineEnd);

    if (line.trim() === needle) {
      const indent = line.match(/^\s*/u)?.[0] ?? "";
      const marker = line
        .slice(indent.length)
        .match(/^(?:[-+*]|\d+[.)])(?=\s)/u)?.[0];

      if (!marker) return null;

      return {
        from: lineStart + indent.length,
        to: lineEnd,
        next: newline < 0 ? source.length : newline + 1,
        indent,
        marker,
      };
    }

    if (newline < 0) break;
    lineStart = newline + 1;
  }

  return null;
}

function findListItemSubtreeTo(
  source: string,
  from: number,
  indentLength: number,
  ownLineTo: number,
): number {
  let subtreeTo = ownLineTo;
  let lineStart = from;

  while (lineStart < source.length) {
    const newline = source.indexOf("\n", lineStart);
    const rawEnd = newline < 0 ? source.length : newline;
    const lineEnd =
      rawEnd > lineStart && source[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
    const line = source.slice(lineStart, lineEnd);

    if (line.trim().length > 0) {
      const nextIndent = line.length - line.trimStart().length;
      if (nextIndent <= indentLength) break;
      subtreeTo = lineEnd;
    }

    if (newline < 0) break;
    lineStart = newline + 1;
  }

  return subtreeTo;
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
      (node) =>
        node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim(),
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

function isListToken(token: MarkedToken): token is MarkedListToken {
  return token.type === "list";
}

function blockKind(token: MarkedToken): MarkdownSourceBlock["kind"] {
  switch (token.type) {
    case "heading":
      return "heading";
    case "paragraph":
    case "text":
      return "paragraph";
    default:
      return "other";
  }
}

function setSourceBlock(
  element: HTMLElement,
  block: MarkdownSourceBlock,
): void {
  element.setAttribute(SOURCE_FROM_ATTRIBUTE, String(block.from));
  element.setAttribute(SOURCE_TO_ATTRIBUTE, String(block.to));
  element.setAttribute(SUBTREE_TO_ATTRIBUTE, String(block.subtreeTo));
  element.setAttribute(BLOCK_KIND_ATTRIBUTE, block.kind);

  if (block.listIndent !== undefined) {
    element.setAttribute(LIST_INDENT_ATTRIBUTE, block.listIndent);
  }
  if (block.listMarker !== undefined) {
    element.setAttribute(LIST_MARKER_ATTRIBUTE, block.listMarker);
  }
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
