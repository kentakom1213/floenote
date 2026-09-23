import { markdown } from "@codemirror/lang-markdown";
import { basicSetup, EditorView } from "codemirror";
import { LoroExtensions } from "loro-codemirror";
import { UndoManager } from "loro-crdt";
import { useEffect, useRef } from "react";

import type { NoteDocument } from "@floe-note/document";

type MarkdownEditorProps = {
  document: NoteDocument;
};

export function MarkdownEditor({ document }: MarkdownEditorProps) {
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

    return () => view.destroy();
  }, [document]);

  return <div className="editor" ref={hostRef} />;
}
