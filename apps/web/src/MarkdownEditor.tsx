import { markdown } from "@codemirror/lang-markdown";
import { basicSetup, EditorView } from "codemirror";
import { LoroExtensions } from "loro-codemirror";
import { UndoManager } from "loro-crdt";
import { useEffect, useRef } from "react";

import type { NoteDocument } from "@floe-note/document";

import { markdownLivePreview } from "./markdown-live-preview.js";

type MarkdownEditorProps = {
  document: NoteDocument;
  livePreview?: boolean;
};

export function MarkdownEditor({
  document,
  livePreview = false,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const binding = document.getEditorBinding();
    const undoManager = new UndoManager(binding.doc, {});
    const view = new EditorView({
      parent: host,
      extensions: [
        basicSetup,
        markdown(),
        livePreview ? markdownLivePreview() : [],
        EditorView.lineWrapping,
        EditorView.editorAttributes.of({
          "aria-label": "Markdown editor",
        }),
        EditorView.contentAttributes.of({
          spellcheck: "true",
          autocapitalize: "sentences",
        }),
        LoroExtensions(binding.doc, undefined, undoManager, binding.getText),
      ],
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
    };
  }, [document, livePreview]);

  return <div className="editor" ref={hostRef} />;
}
