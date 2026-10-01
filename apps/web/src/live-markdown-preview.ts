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
  type LiveMarkdownListContext,
} from "./live-markdown-blocks.js";

class MarkdownBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly list: LiveMarkdownListContext | undefined,
  ) {
    super();
  }

  eq(other: MarkdownBlockWidget): boolean {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.list?.ordered === other.list?.ordered &&
      this.list?.number === other.list?.number
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-preview live-markdown-block";
    wrapper.dataset.floeLiveSourceFrom = String(this.from);

    if (this.list) {
      renderListItem(wrapper, this.source, this.list);
    } else {
      wrapper.innerHTML = renderMarkdown(this.source);
    }

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

function renderListItem(
  wrapper: HTMLElement,
  source: string,
  list: LiveMarkdownListContext,
): void {
  const rendered = new DOMParser().parseFromString(
    renderMarkdown(source),
    "text/html",
  );
  const renderedList = Array.from(rendered.body.children).find(
    (element) => element.tagName === "UL" || element.tagName === "OL",
  );
  const renderedItem = renderedList?.querySelector(":scope > li");

  if (!renderedItem) {
    wrapper.innerHTML = renderMarkdown(source);
    return;
  }

  const row = document.createElement("div");
  row.className = "live-markdown-list-item";

  const marker = document.createElement("span");
  marker.className = "live-markdown-list-marker";
  marker.textContent = list.ordered ? `${list.number ?? 1}.` : "•";
  marker.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "live-markdown-list-content";
  for (const child of Array.from(renderedItem.childNodes)) {
    content.append(child.cloneNode(true));
  }

  row.append(marker, content);
  wrapper.append(row);
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
          block.list,
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
