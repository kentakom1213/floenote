import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { collectMarkdownLivePreviewTokens } from "./markdown-live-preview-syntax.js";

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

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const tokens = collectMarkdownLivePreviewTokens(
    view.state,
    view.visibleRanges,
  );
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
