import type {
  FocusEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
} from "react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { NoteDocument } from "@floe-note/document";

import {
  getMarkdownPreviewSource,
  renderMarkdownWithImagePolicy,
  subscribeMarkdownPreview,
} from "./MarkdownPreview.js";
import {
  annotateMarkdownSourceRanges,
  readMarkdownSourceBlock,
  type MarkdownSourceBlock,
} from "./markdown-source-ranges.js";

type FocusAt = "start" | "end";

type ActiveBlock = MarkdownSourceBlock & {
  sourceSnapshot: string;
  focusAt: FocusAt;
};

type SelectedBlock = {
  from: number;
  to: number;
  sourceSnapshot: string;
};

type PendingBlock = {
  sourceSnapshot: string;
  insertAt: number;
  prefix: string;
  initialValue: string;
  kind: "paragraph" | "list-item";
  listIndent?: string;
  listMarker?: string;
  anchorFrom: number;
  anchorTo: number;
};

type MarkdownRenderedLivePreviewProps = {
  document: NoteDocument;
};

type CommitResult = {
  source: string;
  block: ActiveBlock;
  delta: number;
};

export function MarkdownRenderedLivePreview({
  document,
}: MarkdownRenderedLivePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeBlock, setActiveBlock] = useState<ActiveBlock | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<SelectedBlock | null>(null);
  const [pendingBlock, setPendingBlock] = useState<PendingBlock | null>(null);

  const subscribe = useCallback(
    (listener: () => void) => subscribeMarkdownPreview(document, listener),
    [document],
  );
  const getSnapshot = useCallback(
    () => getMarkdownPreviewSource(document),
    [document],
  );
  const markdown = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const html = useMemo(
    () =>
      renderLiveMarkdown(markdown, activeBlock, selectedBlock, pendingBlock),
    [activeBlock, markdown, pendingBlock, selectedBlock],
  );

  useLayoutEffect(() => {
    const textarea = containerRef.current?.querySelector<HTMLTextAreaElement>(
      ".markdown-live-editor",
    );
    if (textarea) {
      resizeTextarea(textarea);
      textarea.focus();

      if (textarea.dataset.floePending === "true") {
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        return;
      }

      const caret =
        activeBlock?.focusAt === "start"
          ? editableStartOffset(textarea.value, activeBlock.kind)
          : textarea.value.length;
      textarea.setSelectionRange(caret, caret);
      return;
    }

    if (!selectedBlock) return;
    const selected = findBlockElement(containerRef.current, selectedBlock);
    selected?.focus();
  }, [activeBlock, pendingBlock, selectedBlock]);

  const commitActive = useCallback(
    (block: ActiveBlock, value: string): CommitResult | null => {
      if (document.bodyText !== block.sourceSnapshot) return null;

      const expected = block.sourceSnapshot.slice(block.from, block.to);
      if (document.bodyText.slice(block.from, block.to) !== expected) {
        return null;
      }

      const binding = document.getEditorBinding();
      binding
        .getText(binding.doc)
        .splice(block.from, block.to - block.from, value);
      binding.doc.commit();

      const delta = value.length - (block.to - block.from);
      const source =
        block.sourceSnapshot.slice(0, block.from) +
        value +
        block.sourceSnapshot.slice(block.to);

      return {
        source,
        delta,
        block: {
          ...block,
          to: block.from + value.length,
          subtreeTo: block.subtreeTo + delta,
          sourceSnapshot: source,
        },
      };
    },
    [document],
  );

  const commitPending = useCallback(
    (pending: PendingBlock, value: string): CommitResult | null => {
      if (
        value === pending.initialValue ||
        document.bodyText !== pending.sourceSnapshot
      ) {
        return null;
      }

      const insertion = pending.prefix + value;
      const binding = document.getEditorBinding();
      binding.getText(binding.doc).splice(pending.insertAt, 0, insertion);
      binding.doc.commit();

      const source =
        pending.sourceSnapshot.slice(0, pending.insertAt) +
        insertion +
        pending.sourceSnapshot.slice(pending.insertAt);
      const from = pending.insertAt + pending.prefix.length;
      const to = from + value.length;

      return {
        source,
        delta: insertion.length,
        block: {
          from,
          to,
          subtreeTo: to,
          kind: pending.kind,
          ...(pending.listIndent === undefined
            ? {}
            : { listIndent: pending.listIndent }),
          ...(pending.listMarker === undefined
            ? {}
            : { listMarker: pending.listMarker }),
          sourceSnapshot: source,
          focusAt: "end",
        },
      };
    },
    [document],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".markdown-live-editor")) return;

      const blockElement = target.closest<HTMLElement>(
        "[data-floe-source-from][data-floe-source-to]",
      );
      if (!blockElement) return;

      const block = readMarkdownSourceBlock(blockElement);
      if (!block) return;

      setPendingBlock(null);
      setSelectedBlock(null);
      setActiveBlock({
        ...block,
        sourceSnapshot: document.bodyText,
        focusAt: "end",
      });
    },
    [document],
  );

  const handleInput = useCallback((event: FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      resizeTextarea(target);
    }
  }, []);

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !(target instanceof HTMLTextAreaElement) ||
        !target.classList.contains("markdown-live-editor") ||
        target.dataset.floeLiveHandled === "true"
      ) {
        return;
      }

      if (target.dataset.floePending === "true") {
        if (pendingBlock) {
          commitPending(pendingBlock, target.value);
        }
        setPendingBlock(null);
        return;
      }

      if (activeBlock) {
        commitActive(activeBlock, target.value);
      }
      setActiveBlock(null);
    },
    [activeBlock, commitActive, commitPending, pendingBlock],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !(target instanceof HTMLTextAreaElement) ||
        !target.classList.contains("markdown-live-editor")
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        target.dataset.floeLiveHandled = "true";

        if (target.dataset.floePending === "true") {
          if (!pendingBlock) return;

          const committed = commitPending(pendingBlock, target.value);
          setPendingBlock(null);
          setActiveBlock(null);

          if (committed) {
            setSelectedBlock({
              from: committed.block.from,
              to: committed.block.to,
              sourceSnapshot: committed.source,
            });
          } else {
            setSelectedBlock({
              from: pendingBlock.anchorFrom,
              to: pendingBlock.anchorTo,
              sourceSnapshot: pendingBlock.sourceSnapshot,
            });
          }
          return;
        }

        if (!activeBlock) return;
        const committed = commitActive(activeBlock, target.value);
        setActiveBlock(null);
        setPendingBlock(null);

        if (committed) {
          setSelectedBlock({
            from: committed.block.from,
            to: committed.block.to,
            sourceSnapshot: committed.source,
          });
        } else {
          setSelectedBlock(null);
        }
        return;
      }

      const plainEnter =
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;

      if (
        plainEnter &&
        target.selectionStart === target.selectionEnd &&
        target.selectionEnd === target.value.length
      ) {
        event.preventDefault();
        target.dataset.floeLiveHandled = "true";

        if (target.dataset.floePending === "true") {
          if (!pendingBlock || target.value === pendingBlock.initialValue) {
            return;
          }

          const committed = commitPending(pendingBlock, target.value);
          if (!committed) {
            setPendingBlock(null);
            return;
          }

          setActiveBlock(null);
          setSelectedBlock(null);
          setPendingBlock(pendingAfter(committed.block, committed.source));
          return;
        }

        if (!activeBlock) return;
        const committed = commitActive(activeBlock, target.value);
        if (!committed) {
          setActiveBlock(null);
          return;
        }

        setActiveBlock(null);
        setSelectedBlock(null);
        setPendingBlock(pendingAfter(committed.block, committed.source));
        return;
      }

      const isPlainArrow =
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;

      if (
        !isPlainArrow ||
        !activeBlock ||
        target.dataset.floePending === "true" ||
        target.selectionStart !== target.selectionEnd
      ) {
        return;
      }

      const atBoundary =
        event.key === "ArrowUp"
          ? isFirstLogicalLine(target.value, target.selectionStart)
          : isLastLogicalLine(target.value, target.selectionEnd);
      if (!atBoundary) return;

      const adjacent = adjacentBlock(
        containerRef.current,
        activeBlock,
        event.key === "ArrowUp" ? -1 : 1,
      );
      if (!adjacent) return;

      event.preventDefault();
      target.dataset.floeLiveHandled = "true";
      const committed = commitActive(activeBlock, target.value);
      if (!committed) {
        setActiveBlock(null);
        return;
      }

      setPendingBlock(null);
      setSelectedBlock(null);
      setActiveBlock({
        ...adjustBlockAfterEdit(adjacent, activeBlock, committed.delta),
        sourceSnapshot: committed.source,
        focusAt: event.key === "ArrowUp" ? "end" : "start",
      });
    },
    [activeBlock, commitActive, commitPending, pendingBlock],
  );

  if (!markdown.trim() && !pendingBlock) {
    return (
      <div className="markdown-preview markdown-preview-empty">
        <p>Nothing to preview yet.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="markdown-rendered-live-preview"
      onClick={handleClick}
      onInput={handleInput}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <div
        className="markdown-preview"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export function renderLiveMarkdown(
  source: string,
  activeBlock: ActiveBlock | null,
  selectedBlock: SelectedBlock | null = null,
  pendingBlock: PendingBlock | null = null,
): string {
  const rendered = renderMarkdownWithImagePolicy(source, {
    loadExternalImages: false,
    interactiveTasks: false,
  });
  const parsed = new DOMParser().parseFromString(rendered.html, "text/html");
  annotateMarkdownSourceRanges(parsed, source);

  if (selectedBlock?.sourceSnapshot === source) {
    markSelectedBlock(parsed, selectedBlock);
  }

  if (activeBlock?.sourceSnapshot === source) {
    replaceActiveBlockWithEditor(parsed, source, activeBlock);
  }

  if (pendingBlock?.sourceSnapshot === source) {
    insertPendingEditor(parsed, pendingBlock);
  }

  return parsed.body.innerHTML;
}

function replaceActiveBlockWithEditor(
  document: Document,
  source: string,
  block: ActiveBlock,
): void {
  const target = findBlockElement(document.body, block);
  if (!target) return;

  const textarea = document.createElement("textarea");
  textarea.className = "markdown-live-editor";
  textarea.setAttribute("aria-label", "Markdown block editor");
  textarea.setAttribute("spellcheck", "true");
  textarea.rows = Math.max(
    1,
    source.slice(block.from, block.to).split("\n").length,
  );
  textarea.textContent = source.slice(block.from, block.to);
  writeBlockAttributes(textarea, block);

  const listItem = target.closest("li");
  if (
    listItem &&
    target.classList.contains("markdown-live-list-item-content")
  ) {
    listItem.classList.add("markdown-live-editing-list-item");
  }

  target.replaceWith(textarea);
}

function insertPendingEditor(
  document: Document,
  pending: PendingBlock,
): void {
  const anchor = findBlockElement(document.body, {
    from: pending.anchorFrom,
    to: pending.anchorTo,
  });
  if (!anchor) return;

  const textarea = document.createElement("textarea");
  textarea.className = "markdown-live-editor markdown-live-pending-editor";
  textarea.setAttribute("aria-label", "New Markdown block editor");
  textarea.setAttribute("spellcheck", "true");
  textarea.setAttribute("data-floe-pending", "true");
  textarea.rows = 1;
  textarea.textContent = pending.initialValue;

  if (pending.kind === "list-item") {
    const anchorItem = anchor.closest("li");
    if (!anchorItem) return;

    const pendingItem = document.createElement("li");
    pendingItem.className = "markdown-live-pending-list-item";
    pendingItem.append(textarea);
    anchorItem.insertAdjacentElement("afterend", pendingItem);
    return;
  }

  anchor.insertAdjacentElement("afterend", textarea);
}

function markSelectedBlock(
  document: Document,
  selected: SelectedBlock,
): void {
  const target = findBlockElement(document.body, selected);
  if (!target) return;

  target.classList.add("markdown-live-selected-block");
  target.setAttribute("tabindex", "0");
}

function pendingAfter(block: ActiveBlock, source: string): PendingBlock {
  if (block.kind === "list-item") {
    const listIndent = block.listIndent ?? "";
    const listMarker = block.listMarker ?? "-";
    return {
      sourceSnapshot: source,
      insertAt: block.subtreeTo,
      prefix: `\n${listIndent}`,
      initialValue: `${listMarker} `,
      kind: "list-item",
      listIndent,
      listMarker,
      anchorFrom: block.from,
      anchorTo: block.to,
    };
  }

  return {
    sourceSnapshot: source,
    insertAt: block.subtreeTo,
    prefix: "\n\n",
    initialValue: "",
    kind: "paragraph",
    anchorFrom: block.from,
    anchorTo: block.to,
  };
}

function adjacentBlock(
  root: HTMLElement | null,
  current: MarkdownSourceBlock,
  direction: -1 | 1,
): MarkdownSourceBlock | null {
  if (!root) return null;

  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("[data-floe-block-kind]"),
  )
    .map((element) => readMarkdownSourceBlock(element))
    .filter((block): block is MarkdownSourceBlock => block !== null);

  const index = blocks.findIndex(
    (block) => block.from === current.from && block.to === current.to,
  );
  if (index < 0) return null;
  return blocks[index + direction] ?? null;
}

function adjustBlockAfterEdit(
  target: MarkdownSourceBlock,
  edited: MarkdownSourceBlock,
  delta: number,
): MarkdownSourceBlock {
  const shift = (offset: number) => (offset >= edited.to ? offset + delta : offset);

  return {
    ...target,
    from: shift(target.from),
    to: shift(target.to),
    subtreeTo: shift(target.subtreeTo),
  };
}

function findBlockElement(
  root: ParentNode | null,
  block: { from: number; to: number },
): HTMLElement | null {
  return (
    root?.querySelector<HTMLElement>(
      `[data-floe-source-from="${block.from}"][data-floe-source-to="${block.to}"]`,
    ) ?? null
  );
}

function writeBlockAttributes(
  element: HTMLElement,
  block: MarkdownSourceBlock,
): void {
  element.setAttribute("data-floe-source-from", String(block.from));
  element.setAttribute("data-floe-source-to", String(block.to));
  element.setAttribute("data-floe-subtree-to", String(block.subtreeTo));
  element.setAttribute("data-floe-block-kind", block.kind);

  if (block.listIndent !== undefined) {
    element.setAttribute("data-floe-list-indent", block.listIndent);
  }
  if (block.listMarker !== undefined) {
    element.setAttribute("data-floe-list-marker", block.listMarker);
  }
}

function editableStartOffset(
  value: string,
  kind: MarkdownSourceBlock["kind"],
): number {
  if (kind !== "list-item") return 0;
  return value.match(/^(?:[-+*]|\d+[.)])\s+/u)?.[0].length ?? 0;
}

function isFirstLogicalLine(value: string, caret: number): boolean {
  return value.slice(0, caret).indexOf("\n") < 0;
}

function isLastLogicalLine(value: string, caret: number): boolean {
  return value.slice(caret).indexOf("\n") < 0;
}

function resizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}
