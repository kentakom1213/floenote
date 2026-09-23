import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

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

type ScanRange = {
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

export function markdownLivePreview() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = buildLivePreviewDecorations(update.view);
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
    },
  );
}

export function collectMarkdownLivePreviewTokens(
  state: EditorState,
): readonly MarkdownLivePreviewToken[] {
  return collectTokens(state, [{ from: 0, to: state.doc.length }]);
}

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const tokens = collectTokens(view.state, view.visibleRanges);
  const ranges: Range<Decoration>[] = [];

  for (const token of tokens) {
    switch (token.kind) {
      case "heading": {
        const lineFrom = view.state.doc.lineAt(token.from).from;
        ranges.push(
          Decoration.line({
            class: `cm-live-heading cm-live-heading-${token.level}`,
          }).range(lineFrom),
        );
        break;
      }
      case "emphasis":
        ranges.push(
          Decoration.mark({ class: "cm-live-emphasis" }).range(
            token.from,
            token.to,
          ),
        );
        break;
      case "strong":
        ranges.push(
          Decoration.mark({ class: "cm-live-strong" }).range(
            token.from,
            token.to,
          ),
        );
        break;
      case "inline-code":
        ranges.push(
          Decoration.mark({ class: "cm-live-inline-code" }).range(
            token.from,
            token.to,
          ),
        );
        break;
      case "link":
        ranges.push(
          Decoration.mark({ class: "cm-live-link" }).range(
            token.from,
            token.to,
          ),
        );
        break;
      case "hidden-syntax":
        if (token.from < token.to) {
          ranges.push(Decoration.replace({}).range(token.from, token.to));
        }
        break;
      case "list-marker":
        ranges.push(
          Decoration.mark({ class: "cm-live-list-marker" }).range(
            token.from,
            token.to,
          ),
        );
        break;
      case "blockquote-line": {
        const lineFrom = view.state.doc.lineAt(token.from).from;
        ranges.push(
          Decoration.line({ class: "cm-live-blockquote" }).range(lineFrom),
        );
        break;
      }
    }
  }

  return Decoration.set(ranges, true);
}

function collectTokens(
  state: EditorState,
  ranges: readonly ScanRange[],
): MarkdownLivePreviewToken[] {
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
