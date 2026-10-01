import { marked } from "marked";

const SOURCE_FROM_ATTRIBUTE = "data-floe-source-from";
const SOURCE_TO_ATTRIBUTE = "data-floe-source-to";
const SUBTREE_FROM_ATTRIBUTE = "data-floe-subtree-from";
const SUBTREE_TO_ATTRIBUTE = "data-floe-subtree-to";
const BLOCK_KIND_ATTRIBUTE = "data-floe-block-kind";
const LIST_INDENT_ATTRIBUTE = "data-floe-list-indent";
const LIST_MARKER_ATTRIBUTE = "data-floe-list-marker";
const LIST_CONTINUATION_INDENT_ATTRIBUTE =
  "data-floe-list-continuation-indent";
const FIRST_CHILD_AT_ATTRIBUTE = "data-floe-first-child-at";
const CHILD_INDENT_ATTRIBUTE = "data-floe-child-indent";
const CHILD_MARKER_ATTRIBUTE = "data-floe-child-marker";

type MarkedToken = ReturnType<typeof marked.lexer>[number];
type MarkedListToken = Extract<MarkedToken, { type: "list" }>;

type SourceCursor = {
  offset: number;
};

export type MarkdownSourceBlock = {
  from: number;
  to: number;
  subtreeFrom: number;
  subtreeTo: number;
  kind: "paragraph" | "heading" | "list-item" | "empty" | "other";
  listIndent?: string;
  listMarker?: string;
  listContinuationIndent?: string;
  firstChildAt?: number;
  childIndent?: string;
  childMarker?: string;
};

export function annotateMarkdownSourceRanges(
  document: Document,
  source: string,
): void {
  const tokens = marked.lexer(source, { gfm: true });
  const children = Array.from(document.body.children);
  const topLevelBlocks: Array<{
    element: HTMLElement;
    from: number;
    to: number;
  }> = [];
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
        subtreeFrom: from,
        subtreeTo: to,
        kind: blockKind(token),
      });
    }

    topLevelBlocks.push({ element, from, to });
    childIndex += 1;
  }

  insertExplicitEmptyBlocks(document, source, topLevelBlocks);
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
  const subtreeFrom = Number(element.getAttribute(SUBTREE_FROM_ATTRIBUTE));
  const subtreeTo = Number(element.getAttribute(SUBTREE_TO_ATTRIBUTE));
  const kind = element.getAttribute(BLOCK_KIND_ATTRIBUTE);

  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    !Number.isSafeInteger(subtreeFrom) ||
    !Number.isSafeInteger(subtreeTo) ||
    to < from ||
    subtreeFrom > from ||
    subtreeTo < to ||
    (kind !== "paragraph" &&
      kind !== "heading" &&
      kind !== "list-item" &&
      kind !== "empty" &&
      kind !== "other")
  ) {
    return null;
  }

  const listIndent = element.getAttribute(LIST_INDENT_ATTRIBUTE);
  const listMarker = element.getAttribute(LIST_MARKER_ATTRIBUTE);
  const listContinuationIndent = element.getAttribute(
    LIST_CONTINUATION_INDENT_ATTRIBUTE,
  );
  const firstChildAt = readOptionalInteger(element, FIRST_CHILD_AT_ATTRIBUTE);
  const childIndent = element.getAttribute(CHILD_INDENT_ATTRIBUTE);
  const childMarker = element.getAttribute(CHILD_MARKER_ATTRIBUTE);

  return {
    from,
    to,
    subtreeFrom,
    subtreeTo,
    kind,
    ...(listIndent === null ? {} : { listIndent }),
    ...(listMarker === null ? {} : { listMarker }),
    ...(listContinuationIndent === null ? {} : { listContinuationIndent }),
    ...(firstChildAt === null ? {} : { firstChildAt }),
    ...(childIndent === null ? {} : { childIndent }),
    ...(childMarker === null ? {} : { childMarker }),
  };
}

export function markdownBlockEditorText(
  source: string,
  block: MarkdownSourceBlock,
): string {
  const raw = source.slice(block.from, block.to);
  if (block.kind === "empty") return "";
  if (block.kind !== "list-item") return raw;

  const continuationIndent = block.listContinuationIndent ?? "";
  if (!continuationIndent) return raw;

  return raw
    .split("\n")
    .map((line, index) =>
      index > 0 && line.startsWith(continuationIndent)
        ? line.slice(continuationIndent.length)
        : line,
    )
    .join("\n");
}

export function markdownBlockSourceText(
  editorText: string,
  block: MarkdownSourceBlock,
): string {
  if (block.kind !== "list-item") return editorText;

  const continuationIndent = block.listContinuationIndent ?? "";
  if (!continuationIndent) return editorText;

  return editorText
    .split("\n")
    .map((line, index) =>
      index === 0 || line.length === 0 ? line : continuationIndent + line,
    )
    .join("\n");
}

function insertExplicitEmptyBlocks(
  document: Document,
  source: string,
  blocks: Array<{ element: HTMLElement; from: number; to: number }>,
): void {
  if (blocks.length === 0) return;

  const first = blocks[0];
  if (first) {
    for (const span of explicitLeadingEmptyLines(source, 0, first.from)) {
      first.element.before(createEmptyBlock(document, span));
    }
  }

  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1];
    const current = blocks[index];
    if (!previous || !current) continue;

    for (const span of explicitMiddleEmptyLines(
      source,
      previous.to,
      current.from,
    )) {
      current.element.before(createEmptyBlock(document, span));
    }
  }

  const last = blocks[blocks.length - 1];
  if (last) {
    for (const span of explicitTrailingEmptyLines(
      source,
      last.to,
      source.length,
    )) {
      document.body.append(createEmptyBlock(document, span));
    }
  }
}

function createEmptyBlock(
  document: Document,
  span: { from: number; to: number },
): HTMLElement {
  const element = document.createElement("div");
  element.className = "markdown-live-empty-block";
  element.setAttribute("aria-label", "Empty Markdown block");
  setSourceBlock(element, {
    from: span.from,
    to: span.to,
    subtreeFrom: span.from,
    subtreeTo: span.to,
    kind: "empty",
  });
  return element;
}

function explicitLeadingEmptyLines(
  source: string,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  return lineBreakSpans(source, from, to);
}

function explicitMiddleEmptyLines(
  source: string,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const spans = lineBreakSpans(source, from, to);
  return spans.length <= 2 ? [] : spans.slice(1, -1);
}

function explicitTrailingEmptyLines(
  source: string,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const spans = lineBreakSpans(source, from, to);
  return spans.length <= 1 ? [] : spans.slice(1);
}

function lineBreakSpans(
  source: string,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let offset = from;

  while (offset < to) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0 || newline >= to) break;

    const start =
      newline > from && source[newline - 1] === "\r" ? newline - 1 : newline;
    spans.push({ from: start, to: newline + 1 });
    offset = newline + 1;
  }

  return spans;
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
        const ranges = measureListItemRanges(source, sourceLine);
        setSourceBlock(contentElement, {
          from: sourceLine.from,
          to: ranges.ownTo,
          subtreeFrom: sourceLine.lineStart,
          subtreeTo: ranges.subtreeTo,
          kind: "list-item",
          listIndent: sourceLine.indent,
          listMarker: sourceLine.marker,
          listContinuationIndent: sourceLine.continuationIndent,
          ...(ranges.firstChildAt === undefined
            ? {}
            : {
                firstChildAt: ranges.firstChildAt,
                childIndent: ranges.childIndent,
                childMarker: ranges.childMarker,
              }),
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

type ListItemSourceLine = {
  lineStart: number;
  from: number;
  to: number;
  next: number;
  indent: string;
  marker: string;
  continuationIndent: string;
};

function findNextListItemLine(
  source: string,
  from: number,
  itemRaw: string,
): ListItemSourceLine | null {
  const firstLine = itemRaw.split(/\r?\n/u)[0] ?? "";
  const needle = firstLine.trim();
  if (!needle) return null;

  let lineStart = from;
  while (lineStart <= source.length) {
    const lineInfo = readLine(source, lineStart);
    const line = lineInfo.text;

    if (line.trim() === needle) {
      const parsed = parseListLine(line);
      if (!parsed) return null;

      return {
        lineStart,
        from: lineStart + parsed.contentOffset,
        to: lineInfo.end,
        next: lineInfo.next,
        indent: parsed.indent,
        marker: parsed.marker,
        continuationIndent:
          parsed.indent + " ".repeat(parsed.marker.length + parsed.separator.length),
      };
    }

    if (lineInfo.next <= lineStart) break;
    lineStart = lineInfo.next;
  }

  return null;
}

function measureListItemRanges(
  source: string,
  sourceLine: ListItemSourceLine,
): {
  ownTo: number;
  subtreeTo: number;
  firstChildAt?: number;
  childIndent?: string;
  childMarker?: string;
} {
  let ownTo = sourceLine.to;
  let subtreeTo = sourceLine.to;
  let firstChildAt: number | undefined;
  let childIndent: string | undefined;
  let childMarker: string | undefined;
  let lineStart = sourceLine.next;

  while (lineStart < source.length) {
    const lineInfo = readLine(source, lineStart);
    const line = lineInfo.text;

    if (line.trim().length === 0) {
      if (firstChildAt === undefined) ownTo = lineInfo.end;
      subtreeTo = lineInfo.end;
      if (lineInfo.next <= lineStart) break;
      lineStart = lineInfo.next;
      continue;
    }

    const indentLength = line.length - line.trimStart().length;
    if (indentLength <= sourceLine.indent.length) break;

    subtreeTo = lineInfo.end;
    const nestedItem = parseListLine(line);
    if (nestedItem && firstChildAt === undefined) {
      firstChildAt = lineStart;
      childIndent = nestedItem.indent;
      childMarker = nestedItem.marker;
    } else if (firstChildAt === undefined) {
      ownTo = lineInfo.end;
    }

    if (lineInfo.next <= lineStart) break;
    lineStart = lineInfo.next;
  }

  return {
    ownTo,
    subtreeTo,
    ...(firstChildAt === undefined ||
    childIndent === undefined ||
    childMarker === undefined
      ? {}
      : { firstChildAt, childIndent, childMarker }),
  };
}

function parseListLine(
  line: string,
): {
  indent: string;
  marker: string;
  separator: string;
  contentOffset: number;
} | null {
  const indent = line.match(/^\s*/u)?.[0] ?? "";
  const rest = line.slice(indent.length);
  const match = rest.match(/^((?:[-+*]|\d+[.)]))([ \t]+)(?=\S|$)/u);
  if (!match) return null;

  const marker = match[1] ?? "";
  const separator = match[2] ?? "";
  return {
    indent,
    marker,
    separator,
    contentOffset: indent.length + marker.length + separator.length,
  };
}

function readLine(
  source: string,
  lineStart: number,
): { text: string; end: number; next: number } {
  const newline = source.indexOf("\n", lineStart);
  const rawEnd = newline < 0 ? source.length : newline;
  const end =
    rawEnd > lineStart && source[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;

  return {
    text: source.slice(lineStart, end),
    end,
    next: newline < 0 ? source.length : newline + 1,
  };
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
  element.setAttribute(SUBTREE_FROM_ATTRIBUTE, String(block.subtreeFrom));
  element.setAttribute(SUBTREE_TO_ATTRIBUTE, String(block.subtreeTo));
  element.setAttribute(BLOCK_KIND_ATTRIBUTE, block.kind);

  if (block.listIndent !== undefined) {
    element.setAttribute(LIST_INDENT_ATTRIBUTE, block.listIndent);
  }
  if (block.listMarker !== undefined) {
    element.setAttribute(LIST_MARKER_ATTRIBUTE, block.listMarker);
  }
  if (block.listContinuationIndent !== undefined) {
    element.setAttribute(
      LIST_CONTINUATION_INDENT_ATTRIBUTE,
      block.listContinuationIndent,
    );
  }
  if (block.firstChildAt !== undefined) {
    element.setAttribute(FIRST_CHILD_AT_ATTRIBUTE, String(block.firstChildAt));
  }
  if (block.childIndent !== undefined) {
    element.setAttribute(CHILD_INDENT_ATTRIBUTE, block.childIndent);
  }
  if (block.childMarker !== undefined) {
    element.setAttribute(CHILD_MARKER_ATTRIBUTE, block.childMarker);
  }
}

function readOptionalInteger(
  element: Element,
  attribute: string,
): number | null {
  const value = element.getAttribute(attribute);
  if (value === null) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
