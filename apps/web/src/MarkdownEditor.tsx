import { markdown } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
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

export const floeEditorSearch = search({ top: true });

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

    let searchPositionPreview: HTMLElement | null = null;

    const updateSearchPositionPreview = () => {
      const searchPanel = view.dom.querySelector<HTMLElement>(
        ".cm-panels-top .cm-search",
      );

      if (!searchPanel) {
        searchPositionPreview?.remove();
        searchPositionPreview = null;
        return;
      }

      if (!searchPositionPreview) {
        searchPositionPreview = searchPanel.cloneNode(true) as HTMLElement;
        searchPositionPreview.classList.add("editor-search-position-preview");
        searchPositionPreview.setAttribute("aria-hidden", "true");
        searchPositionPreview.inert = true;
        view.dom.append(searchPositionPreview);
      }
    };

    const searchPanelObserver = new MutationObserver(updateSearchPositionPreview);
    searchPanelObserver.observe(view.dom, {
      childList: true,
      subtree: true,
    });
    updateSearchPositionPreview();

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
      searchPanelObserver.disconnect();
      searchPositionPreview?.remove();
      unregisterExternalBodyMutationHandler();
      host.removeEventListener("pointerdown", handlePointerDown);
      view.destroy();
      undoManager?.free();
    };
  }, [document, readOnly]);

  return <div className="editor" ref={hostRef} />;
}
