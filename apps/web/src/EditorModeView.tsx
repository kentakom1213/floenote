import { useCallback, useEffect, useRef } from "react";

import type { NoteDocument } from "@floe-note/document";

import { MarkdownEditor } from "./MarkdownEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { getEditorModeLayout } from "./editor-mode-layout.js";
import type { EditorMode } from "./editor-mode-preference.js";
import {
  getPreviewViewportSourcePosition,
  syncPreviewToSourcePosition,
} from "./split-scroll-sync.js";

type EditorModeViewProps = {
  document: NoteDocument;
  mode: EditorMode;
};

type ScrollToSourcePosition = (sourcePosition: number) => void;

export function EditorModeView({ document, mode }: EditorModeViewProps) {
  const layout = getEditorModeLayout(mode);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  const scrollEditorToSourcePositionRef =
    useRef<ScrollToSourcePosition | null>(null);
  const suppressEditorScrollRef = useRef(false);
  const suppressPreviewScrollRef = useRef(false);

  const clearSuppressionNextFrame = useCallback(
    (ref: { current: boolean }) => {
      window.requestAnimationFrame(() => {
        ref.current = false;
      });
    },
    [],
  );

  const handleEditorViewportChange = useCallback(
    (sourcePosition: number) => {
      if (suppressEditorScrollRef.current) return;

      const previewPane = previewPaneRef.current;
      if (!previewPane) return;

      suppressPreviewScrollRef.current = true;
      syncPreviewToSourcePosition(previewPane, sourcePosition);
      clearSuppressionNextFrame(suppressPreviewScrollRef);
    },
    [clearSuppressionNextFrame],
  );

  const handleScrollToSourcePositionReady = useCallback(
    (scrollToSourcePosition: ScrollToSourcePosition | null) => {
      scrollEditorToSourcePositionRef.current = scrollToSourcePosition;
    },
    [],
  );

  useEffect(() => {
    if (!layout.split) return;

    const previewPane = previewPaneRef.current;
    if (!previewPane) return;

    let previewReportFrame: number | null = null;

    const reportPreviewViewportSourcePosition = () => {
      previewReportFrame = null;
      if (suppressPreviewScrollRef.current) return;

      const sourcePosition =
        getPreviewViewportSourcePosition(previewPane);
      const scrollEditorToSourcePosition =
        scrollEditorToSourcePositionRef.current;
      if (
        sourcePosition === null ||
        !scrollEditorToSourcePosition
      ) {
        return;
      }

      suppressEditorScrollRef.current = true;
      scrollEditorToSourcePosition(sourcePosition);
      clearSuppressionNextFrame(suppressEditorScrollRef);
    };

    const handlePreviewScroll = () => {
      if (
        suppressPreviewScrollRef.current ||
        previewReportFrame !== null
      ) {
        return;
      }

      previewReportFrame = window.requestAnimationFrame(
        reportPreviewViewportSourcePosition,
      );
    };

    previewPane.addEventListener("scroll", handlePreviewScroll, {
      passive: true,
    });

    return () => {
      previewPane.removeEventListener("scroll", handlePreviewScroll);
      if (previewReportFrame !== null) {
        window.cancelAnimationFrame(previewReportFrame);
      }
    };
  }, [clearSuppressionNextFrame, layout.split]);

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
              ? {
                  onViewportSourcePositionChange: handleEditorViewportChange,
                  onScrollToSourcePositionReady:
                    handleScrollToSourcePositionReady,
                }
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
