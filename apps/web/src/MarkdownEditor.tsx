import { markdown } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { LoroExtensions } from "loro-codemirror";
import { UndoManager } from "loro-crdt";
import { useEffect, useRef } from "react";

import type { NoteDocument } from "@floe-note/document";

import { floeCodeMirrorAppearance } from "./editor-appearance.js";
import { floeMarkdownIndentation } from "./editor-indentation.js";
import {
  editorUndoGrouping,
  EDITOR_UNDO_MAX_STEPS,
  EDITOR_UNDO_MERGE_INTERVAL_MS,
  synchronousLoroUndoKeymap,
} from "./loro-undo.js";

function createChevronIcon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", "m7 5 5 5-5 5");
  icon.append(path);

  return icon;
}

function createReplaceIcon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("viewBox", "0 0 48 20");
  icon.setAttribute("aria-hidden", "true");
  icon.dataset.floeReplaceIcon = "";

  const addToken = (x: number) => {
    const box = document.createElementNS(namespace, "rect");
    box.setAttribute("x", String(x));
    box.setAttribute("y", "2");
    box.setAttribute("width", "13");
    box.setAttribute("height", "16");
    box.setAttribute("rx", "3");

    const line1 = document.createElementNS(namespace, "line");
    line1.setAttribute("x1", String(x + 3.5));
    line1.setAttribute("y1", "7");
    line1.setAttribute("x2", String(x + 9.5));
    line1.setAttribute("y2", "7");

    const line2 = document.createElementNS(namespace, "line");
    line2.setAttribute("x1", String(x + 3.5));
    line2.setAttribute("y1", "12");
    line2.setAttribute("x2", String(x + 9.5));
    line2.setAttribute("y2", "12");

    icon.append(box, line1, line2);
  };

  addToken(1.5);

  const arrow = document.createElementNS(namespace, "path");
  arrow.setAttribute("d", "M18 10h10m0 0-4-4m4 4-4 4");
  icon.append(arrow);

  addToken(33.5);

  return icon;
}

function createReplaceAllIcon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("viewBox", "0 0 48 30");
  icon.setAttribute("aria-hidden", "true");
  icon.dataset.floeReplaceAllIcon = "";

  const addRow = (y: number) => {
    const addToken = (x: number) => {
      const box = document.createElementNS(namespace, "rect");
      box.setAttribute("x", String(x));
      box.setAttribute("y", String(y));
      box.setAttribute("width", "13");
      box.setAttribute("height", "11");
      box.setAttribute("rx", "2.5");

      const line1 = document.createElementNS(namespace, "line");
      line1.setAttribute("x1", String(x + 3.5));
      line1.setAttribute("y1", String(y + 4));
      line1.setAttribute("x2", String(x + 9.5));
      line1.setAttribute("y2", String(y + 4));

      const line2 = document.createElementNS(namespace, "line");
      line2.setAttribute("x1", String(x + 3.5));
      line2.setAttribute("y1", String(y + 7));
      line2.setAttribute("x2", String(x + 9.5));
      line2.setAttribute("y2", String(y + 7));

      icon.append(box, line1, line2);
    };

    addToken(1.5);

    const arrow = document.createElementNS(namespace, "path");
    arrow.setAttribute(
      "d",
      `M18 ${y + 5.5}h10m0 0-4-4m4 4-4 4`,
    );
    icon.append(arrow);

    addToken(33.5);
  };

  addRow(2);
  addRow(17);

  return icon;
}

function setSearchOptionsOpen(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  open: boolean,
): void {
  panel.dataset.floeSearchOptionsOpen = String(open);
  toggle.setAttribute("aria-expanded", String(open));
  const label = open ? "Hide search options" : "Show search options";
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
}

function enhanceSearchPanel(view: EditorView): void {
  const panel = view.dom.querySelector<HTMLElement>(".cm-search");
  if (!panel) {
    return;
  }

  const previousButton =
    panel.querySelector<HTMLButtonElement>('[name="prev"]');
  const nextButton = panel.querySelector<HTMLButtonElement>('[name="next"]');
  const selectAllButton =
    panel.querySelector<HTMLButtonElement>('[name="select"]');
  previousButton?.setAttribute("title", "Previous match");
  nextButton?.setAttribute("title", "Next match");
  if (selectAllButton) {
    if (selectAllButton.textContent !== "Select all") {
      selectAllButton.textContent = "Select all";
    }
    selectAllButton.title = "Select all matches";
  }

  // CodeMirror emits Next before Previous in the search-panel DOM. Move the
  // existing Previous button once so visual and keyboard order can both be
  // Previous → Next without duplicating either control.
  if (
    nextButton &&
    previousButton &&
    nextButton.nextElementSibling === previousButton
  ) {
    nextButton.before(previousButton);
  }

  const optionTitles = [
    ["case", "Match case", "Match case"],
    ["re", "Use regular expression", "Regular expression"],
    ["word", "Match whole word", "Whole word"],
  ] as const;
  const optionLabels = optionTitles.flatMap(([name, title, text]) => {
    const label = panel
      .querySelector<HTMLInputElement>(`input[name="${name}"]`)
      ?.closest("label");
    if (!label) {
      return [];
    }
    label.setAttribute("title", title);
    const textNode = [...label.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    if (textNode) {
      textNode.textContent = text;
    }
    return [label];
  });

  let optionsMenu = panel.querySelector<HTMLElement>(
    "[data-floe-search-options]",
  );
  if (!optionsMenu && optionLabels.length === optionTitles.length) {
    optionsMenu = document.createElement("div");
    optionsMenu.className = "cm-search-options";
    optionsMenu.dataset.floeSearchOptions = "";
    optionsMenu.setAttribute("role", "group");
    optionsMenu.setAttribute("aria-label", "Search options");
    optionLabels[0]?.before(optionsMenu);
    for (const label of optionLabels) {
      optionsMenu.append(label);
    }
  }

  if (
    optionsMenu &&
    selectAllButton &&
    selectAllButton.parentElement !== optionsMenu
  ) {
    optionsMenu.prepend(selectAllButton);
  }

  if (
    optionsMenu &&
    !panel.querySelector("[data-floe-search-options-toggle]")
  ) {
    const optionsToggle = document.createElement("button");
    optionsToggle.type = "button";
    optionsToggle.className = "cm-search-options-toggle";
    optionsToggle.dataset.floeSearchOptionsToggle = "";
    optionsToggle.setAttribute("aria-haspopup", "true");
    optionsToggle.textContent = "…";
    panel.dataset.floeSearchOptionsOpen = "false";

    setSearchOptionsOpen(panel, optionsToggle, false);
    optionsToggle.addEventListener("click", () => {
      setSearchOptionsOpen(
        panel,
        optionsToggle,
        panel.dataset.floeSearchOptionsOpen !== "true",
      );
    });
    optionsMenu.before(optionsToggle);
  }

  const replaceField =
    panel.querySelector<HTMLInputElement>('input[name="replace"]');
  const replaceButton =
    panel.querySelector<HTMLButtonElement>('button[name="replace"]');
  const replaceAllButton =
    panel.querySelector<HTMLButtonElement>('[name="replaceAll"]');

  if (replaceButton && !replaceButton.querySelector("[data-floe-replace-icon]")) {
    replaceButton.replaceChildren(createReplaceIcon());
    replaceButton.setAttribute("aria-label", "Replace");
    replaceButton.title = "Replace";
  }
  if (
    replaceAllButton &&
    !replaceAllButton.querySelector("[data-floe-replace-all-icon]")
  ) {
    replaceAllButton.replaceChildren(createReplaceAllIcon());
    replaceAllButton.setAttribute("aria-label", "Replace all");
    replaceAllButton.title = "Replace all";
  }

  const lineBreak = panel.querySelector("br");
  const closeButton = panel.querySelector<HTMLButtonElement>('[name="close"]');

  // Keep the real close button in top-row keyboard order. Moving the existing
  // node preserves CodeMirror's close behavior and event handler.
  if (
    replaceField &&
    lineBreak &&
    closeButton &&
    closeButton.nextElementSibling !== lineBreak
  ) {
    lineBreak.before(closeButton);
  }

  // Read-only search panels intentionally stop here: navigation/options chrome
  // still applies, but CodeMirror doesn't render Replace controls.
  if (!replaceField) {
    return;
  }

  if (panel.querySelector("[data-floe-replace-toggle]")) {
    return;
  }

  const replaceToggle = document.createElement("button");
  replaceToggle.type = "button";
  replaceToggle.className = "cm-search-replace-toggle";
  replaceToggle.dataset.floeReplaceToggle = "";
  replaceToggle.append(createChevronIcon());
  panel.dataset.floeReplaceOpen = "false";

  const setReplaceOpen = (open: boolean) => {
    panel.dataset.floeReplaceOpen = String(open);
    replaceToggle.setAttribute("aria-expanded", String(open));
    const label = open ? "Hide replace controls" : "Show replace controls";
    replaceToggle.setAttribute("aria-label", label);
    replaceToggle.title = label;
  };

  setReplaceOpen(false);
  replaceToggle.addEventListener("click", () => {
    setReplaceOpen(panel.dataset.floeReplaceOpen !== "true");
  });
  panel.prepend(replaceToggle);
}

const floeSearchPanelChrome = ViewPlugin.define((view) => {
  const observer = new MutationObserver(() => enhanceSearchPanel(view));
  const handleDocumentPointerDown = (event: PointerEvent) => {
    const panel = view.dom.querySelector<HTMLElement>(".cm-search");
    if (!panel || panel.dataset.floeSearchOptionsOpen !== "true") {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    const optionsToggle = panel.querySelector<HTMLButtonElement>(
      "[data-floe-search-options-toggle]",
    );
    const optionsMenu = panel.querySelector<HTMLElement>(
      "[data-floe-search-options]",
    );
    if (
      optionsToggle?.contains(target) ||
      optionsMenu?.contains(target) ||
      !optionsToggle
    ) {
      return;
    }

    setSearchOptionsOpen(panel, optionsToggle, false);
  };

  observer.observe(view.dom, { childList: true, subtree: true });
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  enhanceSearchPanel(view);

  return {
    destroy() {
      observer.disconnect();
      document.removeEventListener(
        "pointerdown",
        handleDocumentPointerDown,
        true,
      );
    },
  };
});

export const floeEditorSearch = [
  search({ top: true }),
  floeSearchPanelChrome,
];

type MarkdownEditorProps = {
  document: NoteDocument;
  readOnly?: boolean;
  focusRequested?: boolean;
  onFocusHandled?: () => void;
  onViewportSourcePositionChange?: (sourcePosition: number) => void;
  onScrollToSourcePositionReady?: (
    scrollToSourcePosition: ((sourcePosition: number) => void) | null,
  ) => void;
};

export function MarkdownEditor({
  document,
  readOnly = false,
  focusRequested = false,
  onFocusHandled,
  onViewportSourcePositionChange,
  onScrollToSourcePositionReady,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const binding = document.getEditorBinding();
    const undoManager = readOnly
      ? null
      : new UndoManager(binding.doc, {
          maxUndoSteps: EDITOR_UNDO_MAX_STEPS,
          mergeInterval: EDITOR_UNDO_MERGE_INTERVAL_MS,
          excludeOriginPrefixes: [...binding.undoExcludeOriginPrefixes],
        });
    const undoGrouping = undoManager
      ? editorUndoGrouping(undoManager, {
          beginEditorHistoryGroup: binding.beginEditorHistoryGroup,
          endEditorHistoryGroup: binding.endEditorHistoryGroup,
          flushEditorHistoryBoundary: binding.flushEditorHistoryBoundary,
        })
      : null;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: document.bodyText,
        extensions: [
          basicSetup,
          floeEditorSearch,
          markdown(),
          floeMarkdownIndentation,
          ...floeCodeMirrorAppearance,
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.editorAttributes.of({
            "aria-label": "Markdown editor",
          }),
          EditorView.contentAttributes.of({
            spellcheck: "true",
            autocapitalize: "sentences",
          }),
          ...(undoManager && undoGrouping
            ? [synchronousLoroUndoKeymap(undoManager), undoGrouping.before]
            : []),
          LoroExtensions(
            binding.doc,
            undefined,
            undoManager ?? undefined,
            binding.getText,
          ),
          ...(undoGrouping ? [undoGrouping.after] : []),
        ],
      }),
    });
    viewRef.current = view;

    // Initialize CodeMirror from the current NoteDocument synchronously instead
    // of relying on loro-codemirror's initialization microtask. In
    // loro-codemirror 0.3.3 that microtask still sets its initialization flag
    // before noticing that CodeMirror and Loro already match, then returns
    // without clearing it. Let that microtask run first, then send a no-op
    // transaction so the first real user edit is not dropped.
    // Remove this workaround once the upstream fix is published.
    void Promise.resolve().then(() => {
      view.dispatch({});
    });

    let viewportReportFrame: number | null = null;

    const scrollToSourcePosition = (sourcePosition: number) => {
      const maxScrollTop = Math.max(
        0,
        view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
      );

      if (sourcePosition <= 1) {
        view.scrollDOM.scrollTop = 0;
        return;
      }
      if (sourcePosition >= view.state.doc.lines + 1) {
        view.scrollDOM.scrollTop = maxScrollTop;
        return;
      }

      const rawLineNumber = Math.floor(sourcePosition);
      const lineNumber = Math.min(
        view.state.doc.lines,
        Math.max(1, rawLineNumber),
      );
      const fraction = Math.min(
        1,
        Math.max(0, sourcePosition - rawLineNumber),
      );
      const line = view.state.doc.line(lineNumber);
      const block = view.lineBlockAt(line.from);
      view.scrollDOM.scrollTop = Math.min(
        maxScrollTop,
        Math.max(0, block.top + block.height * fraction),
      );
    };

    onScrollToSourcePositionReady?.(scrollToSourcePosition);

    const reportViewportSourcePosition = () => {
      viewportReportFrame = null;
      if (!onViewportSourcePositionChange) return;

      const scrollTop = Math.max(0, view.scrollDOM.scrollTop);
      const block = view.lineBlockAtHeight(scrollTop);
      const line = view.state.doc.lineAt(block.from);
      const fraction =
        block.height > 0
          ? Math.min(1, Math.max(0, (scrollTop - block.top) / block.height))
          : 0;

      onViewportSourcePositionChange(line.number + fraction);
    };

    const scheduleViewportSourcePositionReport = () => {
      if (
        !onViewportSourcePositionChange ||
        viewportReportFrame !== null
      ) {
        return;
      }

      viewportReportFrame = window.requestAnimationFrame(
        reportViewportSourcePosition,
      );
    };

    if (onViewportSourcePositionChange) {
      view.scrollDOM.addEventListener(
        "scroll",
        scheduleViewportSourcePositionReport,
        { passive: true },
      );
      scheduleViewportSourcePositionReport();
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      const target = event.target;
      if (!(target instanceof Node) || view.contentDOM.contains(target)) {
        return;
      }

      if (
        target instanceof Element &&
        target.closest(".cm-panels, .cm-tooltip, .cm-gutters")
      ) {
        return;
      }

      const contentRect = view.contentDOM.getBoundingClientRect();
      const x = Math.min(
        Math.max(event.clientX, contentRect.left + 1),
        Math.max(contentRect.left + 1, contentRect.right - 1),
      );
      const position =
        view.posAtCoords({ x, y: event.clientY }, false) ??
        view.state.doc.length;

      event.preventDefault();
      view.dispatch({
        selection: { anchor: position },
        scrollIntoView: false,
      });
      view.focus();
    };

    host.addEventListener("pointerdown", handlePointerDown);
    const unregisterExternalBodyMutationHandler = readOnly
      ? () => {}
      : binding.registerExternalBodyMutationHandler((mutation) => {
        if (view.state.doc.toString() !== document.bodyText) {
          return false;
        }
        if (
          view.state.doc.sliceString(mutation.from, mutation.to) !==
          mutation.expected
        ) {
          return false;
        }

        view.dispatch({
          changes: {
            from: mutation.from,
            to: mutation.to,
            insert: mutation.insert,
          },
          userEvent: "input",
        });

        return view.state.doc.toString() === document.bodyText;
      });

    return () => {
      unregisterExternalBodyMutationHandler();
      host.removeEventListener("pointerdown", handlePointerDown);
      view.scrollDOM.removeEventListener(
        "scroll",
        scheduleViewportSourcePositionReport,
      );
      if (viewportReportFrame !== null) {
        window.cancelAnimationFrame(viewportReportFrame);
      }
      onScrollToSourcePositionReady?.(null);
      if (viewRef.current === view) {
        viewRef.current = null;
      }
      view.destroy();
      undoManager?.free();
    };
  }, [
    document,
    onScrollToSourcePositionReady,
    onViewportSourcePositionChange,
    readOnly,
  ]);

  useEffect(() => {
    if (!focusRequested) return;

    const view = viewRef.current;
    if (!view) return;

    view.focus();
    onFocusHandled?.();
  }, [document, focusRequested, onFocusHandled]);

  return <div className="editor" ref={hostRef} />;
}
