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
import {
  editorUndoGrouping,
  EDITOR_UNDO_MAX_STEPS,
  EDITOR_UNDO_MERGE_INTERVAL_MS,
  synchronousLoroUndoKeymap,
} from "./loro-undo.js";

function enhanceSearchPanel(view: EditorView): void {
  const panel = view.dom.querySelector<HTMLElement>(".cm-search");
  if (!panel || panel.querySelector("[data-floe-replace-toggle]")) {
    return;
  }

  const replaceField =
    panel.querySelector<HTMLInputElement>('input[name="replace"]');
  if (!replaceField) {
    return;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cm-search-replace-toggle";
  toggle.dataset.floeReplaceToggle = "";
  panel.dataset.floeReplaceOpen = "false";

  const setReplaceOpen = (open: boolean) => {
    panel.dataset.floeReplaceOpen = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute(
      "aria-label",
      open ? "Hide replace controls" : "Show replace controls",
    );
    toggle.textContent = open ? "⌄" : "›";
  };

  setReplaceOpen(false);
  toggle.addEventListener("click", () => {
    setReplaceOpen(panel.dataset.floeReplaceOpen !== "true");
  });
  panel.prepend(toggle);

  const optionTitles = [
    ["case", "Match case"],
    ["re", "Use regular expression"],
    ["word", "Match whole word"],
  ] as const;
  for (const [name, title] of optionTitles) {
    panel
      .querySelector<HTMLInputElement>(`input[name="${name}"]`)
      ?.closest("label")
      ?.setAttribute("title", title);
  }
}

const floeSearchPanelChrome = ViewPlugin.define((view) => {
  const observer = new MutationObserver(() => enhanceSearchPanel(view));
  observer.observe(view.dom, { childList: true, subtree: true });
  enhanceSearchPanel(view);

  return {
    destroy() {
      observer.disconnect();
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
};

export function MarkdownEditor({
  document,
  readOnly = false,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);

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
      extensions: [
        basicSetup,
        floeEditorSearch,
        markdown(),
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
    });

    // loro-codemirror 0.3.3 can leave its initialization flag set when the
    // editor and Loro text are both empty. Its next real edit is then mistaken
    // for the initialization dispatch and dropped. Let the binding's init
    // microtask run first, then send a no-op transaction to clear that flag.
    // Remove this workaround once the upstream fix is published.
    void Promise.resolve().then(() => {
      view.dispatch({});
    });

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
      view.destroy();
      undoManager?.free();
    };
  }, [document, readOnly]);

  return <div className="editor" ref={hostRef} />;
}
