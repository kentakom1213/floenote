import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type MarkdownLivePreviewToken =
  | {
      kind: "heading";
      from: number;
      to: number;
      active: boolean;
      level: 1 | 2 | 3 | 4 | 5 | 6;
    }
  | {
      kind: "emphasis" | "strong" | "inline-code" | "link";
      from: number;
      to: number;
      active: boolean;
    }
  | {
      kind: "hidden-syntax" | "list-marker" | "blockquote-line";
      from: number;
      to: number;
    };

export type MarkdownLivePreviewScanRange = {
  from: number;
  to: number;
};

const HIDDEN_MARKERS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "LinkTitle",
  "QuoteMark",
]);

const OWNER_NODES = new Set([
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "Emphasis",
  "StrongEmphasis",
  "InlineCode",
  "Link",
  "Blockquote",
]);

export function collectMarkdownLivePreviewTokens(
  state: EditorState,
  ranges: readonly MarkdownLivePreviewScanRange[] = [
    { from: 0, to: state.doc.length },
  ],
): readonly MarkdownLivePreviewToken[] {
  const tokens: MarkdownLivePreviewToken[] = [];
  const tree = syntaxTree(state);

  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        const headingLevel = headingLevelFor(node.name);
        if (headingLevel !== null) {
          tokens.push({
            kind: "heading",
            from: node.from,
            to: node.to,
            active: selectionTouches(state, node.from, node.to),
            level: headingLevel,
          });
          return;
        }

        if (node.name === "Emphasis") {
          tokens.push({
            kind: "emphasis",
            from: node.from,
            to: node.to,
            active: selectionTouches(state, node.from, node.to),
          });
          return;
        }

        if (node.name === "StrongEmphasis") {
          tokens.push({
            kind: "strong",
            from: node.from,
            to: node.to,
            active: selectionTouches(state, node.from, node.to),
          });
          return;
        }

        if (node.name === "InlineCode") {
          tokens.push({
            kind: "inline-code",
            from: node.from,
            to: node.to,
            active: selectionTouches(state, node.from, node.to),
          });
          return;
        }

        if (node.name === "Link") {
          tokens.push({
            kind: "link",
            from: node.from,
            to: node.to,
            active: selectionTouches(state, node.from, node.to),
          });
          return;
        }

        if (node.name === "ListMark") {
          tokens.push({
            kind: "list-marker",
            from: node.from,
            to: node.to,
          });
          return;
        }

        if (node.name === "QuoteMark") {
          tokens.push({
            kind: "blockquote-line",
            from: node.from,
            to: node.to,
          });
        }

        if (!HIDDEN_MARKERS.has(node.name)) return;

        let owner = node.node.parent;
        while (owner && !OWNER_NODES.has(owner.name)) {
          owner = owner.parent;
        }
        if (!owner) return;

        if (node.name === "CodeMark" && owner.name === "FencedCode") {
          return;
        }

        if (!selectionTouches(state, owner.from, owner.to)) {
          tokens.push({
            kind: "hidden-syntax",
            from: node.from,
            to: node.to,
          });
        }
      },
    });
  }

  return tokens;
}

function headingLevelFor(
  name: string,
): 1 | 2 | 3 | 4 | 5 | 6 | null {
  switch (name) {
    case "ATXHeading1":
    case "SetextHeading1":
      return 1;
    case "ATXHeading2":
    case "SetextHeading2":
      return 2;
    case "ATXHeading3":
      return 3;
    case "ATXHeading4":
      return 4;
    case "ATXHeading5":
      return 5;
    case "ATXHeading6":
      return 6;
    default:
      return null;
  }
}

function selectionTouches(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.head >= from && range.head <= to;
    }
    return range.from < to && range.to > from;
  });
}
