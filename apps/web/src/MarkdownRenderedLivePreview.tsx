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
  readMarkdownSourceRange,
} from "./markdown-source-ranges.js";

type ActiveBlock = {
  from: number;
  to: number;
  sourceSnapshot: string;
};

type MarkdownRenderedLivePreviewProps = {
  document: NoteDocument;
};

export function MarkdownRenderedLivePreview({
  document,
}: MarkdownRenderedLivePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeBlock, setActiveBlock] = useState<ActiveBlock | null>(null);

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
    () => renderLiveMarkdown(markdown, activeBlock),
    [activeBlock, markdown],
  );

  useLayoutEffect(() => {
    if (!activeBlock) return;

    const textarea = containerRef.current?.querySelector<HTMLTextAreaElement>(
      ".markdown-live-editor",
    );
    if (!textarea) return;

    resizeTextarea(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [activeBlock]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".markdown-live-editor")) return;

      const block = target.closest<HTMLElement>(
        "[data-floe-source-from][data-floe-source-to]",
      );
      if (!block) return;

      const range = readMarkdownSourceRange(block);
      if (!range) return;

      setActiveBlock({
        ...range,
        sourceSnapshot: markdown,
      });
    },
    [markdown],
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
        !target.classList.contains("markdown-live-editor")
      ) {
        return;
      }

      if (target.dataset.floeLiveCancel === "true") {
        setActiveBlock(null);
        return;
      }

      if (!activeBlock || document.bodyText !== activeBlock.sourceSnapshot) {
        setActiveBlock(null);
        return;
      }

      const expected = activeBlock.sourceSnapshot.slice(
        activeBlock.from,
        activeBlock.to,
      );
      if (
        document.bodyText.slice(activeBlock.from, activeBlock.to) !== expected
      ) {
        setActiveBlock(null);
        return;
      }

      const binding = document.getEditorBinding();
      binding
        .getText(binding.doc)
        .splice(
          activeBlock.from,
          activeBlock.to - activeBlock.from,
          target.value,
        );
      binding.doc.commit();
      setActiveBlock(null);
    },
    [activeBlock, document],
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
        target.dataset.floeLiveCancel = "true";
        setActiveBlock(null);
        return;
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        target.blur();
      }
    },
    [],
  );

  if (!markdown.trim()) {
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
): string {
  const rendered = renderMarkdownWithImagePolicy(source, {
    loadExternalImages: false,
    interactiveTasks: false,
  });
  const parsed = new DOMParser().parseFromString(rendered.html, "text/html");
  annotateMarkdownSourceRanges(parsed, source);

  if (activeBlock?.sourceSnapshot === source) {
    replaceActiveBlockWithEditor(parsed, source, activeBlock);
  }

  return parsed.body.innerHTML;
}

function replaceActiveBlockWithEditor(
  document: Document,
  source: string,
  block: ActiveBlock,
): void {
  const selector =
    `[data-floe-source-from="${block.from}"]` +
    `[data-floe-source-to="${block.to}"]`;
  const target = document.body.querySelector<HTMLElement>(selector);
  if (!target) return;

  const textarea = document.createElement("textarea");
  textarea.className = "markdown-live-editor";
  textarea.setAttribute("aria-label", "Markdown block editor");
  textarea.setAttribute("spellcheck", "true");
  textarea.rows = Math.max(1, source.slice(block.from, block.to).split("\n").length);
  textarea.textContent = source.slice(block.from, block.to);

  const listItem = target.closest("li");
  if (
    listItem &&
    target.classList.contains("markdown-live-list-item-content")
  ) {
    listItem.classList.add("markdown-live-editing-list-item");
  }

  target.replaceWith(textarea);
}

function resizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}
