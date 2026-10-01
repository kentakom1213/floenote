import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type LiveMarkdownBlockKind =
  | "heading"
  | "paragraph"
  | "code"
  | "list"
  | "math";

export type LiveMarkdownListContext = {
  ordered: boolean;
  number: number | null;
};

export type LiveMarkdownBlock = {
  from: number;
  to: number;
  kind: LiveMarkdownBlockKind;
  list?: LiveMarkdownListContext;
};

export function collectLiveMarkdownBlocks(
  state: EditorState,
): LiveMarkdownBlock[] {
  const syntaxBlocks: LiveMarkdownBlock[] = [];
  const fencedCodeRanges: Array<{ from: number; to: number }> = [];

  for (
    let node = syntaxTree(state).topNode.firstChild;
    node;
    node = node.nextSibling
  ) {
    if (node.name === "BulletList" || node.name === "OrderedList") {
      const ordered = node.name === "OrderedList";
      const items = [];
      for (let item = node.firstChild; item; item = item.nextSibling) {
        if (item.name === "ListItem") items.push(item);
      }

      const start = ordered ? orderedListStart(state, items[0]) : 1;
      items.forEach((item, index) => {
        syntaxBlocks.push({
          from: item.from,
          to: item.to,
          kind: "list",
          list: {
            ordered,
            number: ordered ? start + index : null,
          },
        });
      });
      continue;
    }

    const kind = syntaxNodeKind(node.name);
    if (!kind) continue;

    const block = { from: node.from, to: node.to, kind };
    syntaxBlocks.push(block);
    if (kind === "code") {
      fencedCodeRanges.push({ from: node.from, to: node.to });
    }
  }

  const mathBlocks = collectDisplayMathBlocks(state, fencedCodeRanges);

  return [...syntaxBlocks, ...mathBlocks]
    .filter(
      (block, index, blocks) =>
        block.kind === "math" ||
        !mathBlocks.some((math) => rangesOverlap(block, math)) ||
        blocks[index]?.kind === "math",
    )
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

function orderedListStart(
  state: EditorState,
  item: ReturnType<typeof syntaxTree>["topNode"] | undefined,
): number {
  if (!item) return 1;

  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name !== "ListMark") continue;

    const match = /^(\d+)[.)]$/u.exec(state.sliceDoc(child.from, child.to));
    if (!match) return 1;

    const start = Number(match[1]);
    return Number.isSafeInteger(start) && start >= 0 ? start : 1;
  }

  return 1;
}

function syntaxNodeKind(name: string): LiveMarkdownBlockKind | null {
  if (
    /^ATXHeading[1-6]$/u.test(name) ||
    /^SetextHeading[1-2]$/u.test(name)
  ) {
    return "heading";
  }

  if (name === "Paragraph") return "paragraph";
  if (name === "FencedCode") return "code";
  return null;
}

function collectDisplayMathBlocks(
  state: EditorState,
  fencedCodeRanges: readonly { from: number; to: number }[],
): LiveMarkdownBlock[] {
  const blocks: LiveMarkdownBlock[] = [];
  let openingLine: { from: number } | null = null;

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);

    if (
      fencedCodeRanges.some(
        (range) => line.from >= range.from && line.from < range.to,
      )
    ) {
      openingLine = null;
      continue;
    }

    if (line.text.trim() !== "$$") continue;

    if (!openingLine) {
      openingLine = { from: line.from };
      continue;
    }

    blocks.push({
      from: openingLine.from,
      to: line.to,
      kind: "math",
    });
    openingLine = null;
  }

  return blocks;
}

function rangesOverlap(
  left: { from: number; to: number },
  right: { from: number; to: number },
): boolean {
  return left.from < right.to && right.from < left.to;
}
