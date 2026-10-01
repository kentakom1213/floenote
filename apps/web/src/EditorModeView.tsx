import { useCallback, useRef } from "react";
import type { NoteDocument } from "@floe-note/document";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./MarkdownEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { getEditorModeLayout } from "./editor-mode-layout.js";
import type { EditorMode } from "./editor-mode-preference.js";
import {
  sourceLineAtPreviewTop,
  syncPreviewToSourceLine,
} from "./split-scroll-sync.js";

type EditorModeViewProps = {
  document: NoteDocument;
  mode: EditorMode;
};

export function EditorModeView({ document, mode }: EditorModeViewProps) {
  const layout = getEditorModeLayout(mode);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  const scrollOwnerRef = useRef<"editor" | "preview" | null>(null);

  const markEditorScrollOwner = useCallback(() => {
    scrollOwnerRef.current = "editor";
  }, []);
  const markPreviewScrollOwner = useCallback(() => {
    scrollOwnerRef.current = "preview";
  }, []);

  const handleEditorViewportLineChange = useCallback((line: number) => {
    if (scrollOwnerRef.current === "preview") return;

    const previewPane = previewPaneRef.current;
    if (!previewPane || previewPane.scrollHeight <= previewPane.clientHeight) {
      return;
    }
    syncPreviewToSourceLine(previewPane, line);
  }, []);

  const handlePreviewScroll = useCallback(() => {
    if (scrollOwnerRef.current !== "preview") return;

    const previewPane = previewPaneRef.current;
    if (!previewPane) return;

    const sourceLine = sourceLineAtPreviewTop(previewPane);
    if (sourceLine === null) return;

    editorRef.current?.scrollToLine(sourceLine);
  }, []);

  return (
    <div
      className={layout.split ? "editor-view editor-view-split" : "editor-view"}
      data-editor-mode={mode}
    >
      {layout.showEditor ? (
        <div
          className="editor-view-pane editor-view-source"
          onPointerDownCapture={layout.split ? markEditorScrollOwner : undefined}
          onWheelCapture={layout.split ? markEditorScrollOwner : undefined}
        >
          <MarkdownEditor
            ref={editorRef}
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
          onPointerDownCapture={layout.split ? markPreviewScrollOwner : undefined}
          onWheelCapture={layout.split ? markPreviewScrollOwner : undefined}
          onScroll={layout.split ? handlePreviewScroll : undefined}
        >
          <MarkdownPreview document={document} interactive={true} />
        </div>
      ) : null}
    </div>
  );
}
