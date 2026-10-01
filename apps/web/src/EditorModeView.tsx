import { useCallback, useRef } from "react";
import type { NoteDocument } from "@floe-note/document";

import { MarkdownEditor } from "./MarkdownEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { getEditorModeLayout } from "./editor-mode-layout.js";
import type { EditorMode } from "./editor-mode-preference.js";
import { syncPreviewToSourceLine } from "./split-scroll-sync.js";

type EditorModeViewProps = {
  document: NoteDocument;
  mode: EditorMode;
};

export function EditorModeView({ document, mode }: EditorModeViewProps) {
  const layout = getEditorModeLayout(mode);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  const handleEditorViewportLineChange = useCallback((line: number) => {
    const previewPane = previewPaneRef.current;
    if (!previewPane || previewPane.scrollHeight <= previewPane.clientHeight) {
      return;
    }
    syncPreviewToSourceLine(previewPane, line);
  }, []);

  return (
    <div
      className={layout.split ? "editor-view editor-view-split" : "editor-view"}
      data-editor-mode={mode}
    >
      {layout.showEditor ? (
        <div className="editor-view-pane editor-view-source">
          <MarkdownEditor
            document={document}
            {...(layout.split
              ? { onViewportLineChange: handleEditorViewportLineChange }
              : {})}
          />
        </div>
      ) : null}
      {layout.showPreview ? (
        <div
          className="editor-view-pane editor-view-preview"
          ref={layout.split ? previewPaneRef : undefined}
        >
          <MarkdownPreview document={document} interactive={true} />
        </div>
      ) : null}
    </div>
  );
}
