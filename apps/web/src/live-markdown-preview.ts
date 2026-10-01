import { StateField, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

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

function buildDecorations(state: EditorState): DecorationSet {
  const blocks = collectLiveMarkdownBlocks(state);
  const active = blocks.map((block) => isActiveBlock(state, block));

  const ranges = blocks.flatMap((block, index) => {
    if (active[index]) return [];

    const previousBlock = blocks[index - 1];
    const nextBlock = blocks[index + 1];
    const replaceFrom =
      previousBlock && active[index - 1]
        ? leadingWhitespaceStart(state, previousBlock, block)
        : block.from;
    const replaceTo = trailingWhitespaceEnd(state, block, nextBlock);

    return [
      Decoration.replace({
        widget: new MarkdownBlockWidget(
          state.sliceDoc(block.from, block.to),
          block.from,
        ),
        block: true,
      }).range(replaceFrom, replaceTo),
    ];
  });

  return Decoration.set(ranges, true);
}

function leadingWhitespaceStart(
  state: EditorState,
  previousBlock: LiveMarkdownBlock,
  block: LiveMarkdownBlock,
): number {
  if (block.from <= previousBlock.to) return block.from;

  return /^\s*$/u.test(state.sliceDoc(previousBlock.to, block.from))
    ? previousBlock.to
    : block.from;
}

function trailingWhitespaceEnd(
  state: EditorState,
  block: LiveMarkdownBlock,
  nextBlock: LiveMarkdownBlock | undefined,
): number {
  const limit = nextBlock?.from ?? state.doc.length;
  if (limit <= block.to) return block.to;

  return /^\s*$/u.test(state.sliceDoc(block.to, limit))
    ? limit
    : block.to;
}

function isActiveBlock(
  state: EditorState,
  block: LiveMarkdownBlock,
): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.head >= block.from && range.head <= block.to;
    }
    return range.from < block.to && range.to > block.from;
  });
}

const liveMarkdownPreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(_decorations, transaction) {
    return buildDecorations(transaction.state);
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

export const liveMarkdownPreview = liveMarkdownPreviewField;
