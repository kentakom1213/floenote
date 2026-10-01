import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

import { renderMarkdown } from "./MarkdownPreview.js";
import {
  collectLiveMarkdownBlocks,
  type LiveMarkdownBlock,
} from "./live-markdown-blocks.js";

class MarkdownBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: MarkdownBlockWidget): boolean {
    return this.source === other.source && this.from === other.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-preview live-markdown-block";
    wrapper.innerHTML = renderMarkdown(this.source);
    wrapper.dataset.floeLiveSourceFrom = String(this.from);

    wrapper.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;

      event.preventDefault();
      const position = Math.min(this.from, view.state.doc.length);
      view.dispatch({
        selection: { anchor: position },
        scrollIntoView: true,
      });
      view.focus();
    });

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const blocks = collectLiveMarkdownBlocks(view.state);
  const ranges = blocks.flatMap((block) =>
    isActiveBlock(view, block)
      ? []
      : [
          Decoration.replace({
            widget: new MarkdownBlockWidget(
              view.state.sliceDoc(block.from, block.to),
              block.from,
            ),
            block: true,
          }).range(block.from, block.to),
        ],
  );

  return Decoration.set(ranges, true);
}

function isActiveBlock(view: EditorView, block: LiveMarkdownBlock): boolean {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.head >= block.from && range.head <= block.to;
    }
    return range.from < block.to && range.to > block.from;
  });
}

class LiveMarkdownPreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged
    ) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const liveMarkdownPreview = ViewPlugin.fromClass(
  LiveMarkdownPreviewPlugin,
  {
    decorations: (plugin) => plugin.decorations,
  },
);
