import { markdown } from "@codemirror/lang-markdown";
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

type MarkdownEditorProps = {
  document: NoteDocument;
};

export function MarkdownEditor({ document }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const binding = document.getEditorBinding();
    const undoManager = new UndoManager(binding.doc, {
      maxUndoSteps: EDITOR_UNDO_MAX_STEPS,
      mergeInterval: EDITOR_UNDO_MERGE_INTERVAL_MS,
      excludeOriginPrefixes: [...binding.undoExcludeOriginPrefixes],
    });
    const undoGrouping = editorUndoGrouping(undoManager, {
      beginEditorHistoryGroup: binding.beginEditorHistoryGroup,
      endEditorHistoryGroup: binding.endEditorHistoryGroup,
    });
    const view = new EditorView({
      parent: host,
      extensions: [
        basicSetup,
        markdown(),
        ...floeCodeMirrorAppearance,
        EditorView.lineWrapping,
        EditorView.editorAttributes.of({
          "aria-label": "Markdown editor",
        }),
        EditorView.contentAttributes.of({
          spellcheck: "true",
          autocapitalize: "sentences",
        }),
        synchronousLoroUndoKeymap(undoManager),
        undoGrouping.before,
        LoroExtensions(binding.doc, undefined, undoManager, binding.getText),
        undoGrouping.after,
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

    return () => {
      host.removeEventListener("pointerdown", handlePointerDown);
      view.destroy();
      undoManager.free();
    };
  }, [document]);

  return <div className="editor" ref={hostRef} />;
}
