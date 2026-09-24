import type { NoteDocument } from "@floe-note/document";

import { MarkdownEditor } from "./MarkdownEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { getEditorModeLayout } from "./editor-mode-layout.js";
import type { EditorMode } from "./editor-mode-preference.js";

type EditorModeViewProps = {
  document: NoteDocument;
  mode: EditorMode;
};

export function EditorModeView({ document, mode }: EditorModeViewProps) {
  const layout = getEditorModeLayout(mode);

  return (
    <div
      className={layout.split ? "editor-view editor-view-split" : "editor-view"}
      data-editor-mode={mode}
    >
      {layout.showEditor ? (
        <div className="editor-view-pane editor-view-source">
          <MarkdownEditor document={document} />
        </div>
      ) : null}
      {layout.showPreview ? (
        <div className="editor-view-pane editor-view-preview">
          <MarkdownPreview document={document} interactive={true} />
        </div>
      ) : null}
    </div>
  );
}
