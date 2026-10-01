import { useCallback, useLayoutEffect, useRef } from "react";
import type { NoteDocument } from "@floe-note/document";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./MarkdownEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { getEditorModeLayout } from "./editor-mode-layout.js";
import type { EditorMode } from "./editor-mode-preference.js";
import { planHeadingAlignment } from "./split-layout-compensation.js";

type EditorModeViewProps = {
  document: NoteDocument;
  mode: EditorMode;
};

const HEADING_SELECTOR =
  "h1[data-floe-source-start], h2[data-floe-source-start], " +
  "h3[data-floe-source-start], h4[data-floe-source-start], " +
  "h5[data-floe-source-start], h6[data-floe-source-start]";

function isLayoutSpacerNode(node: Node): boolean {
  return (
    node instanceof HTMLElement &&
    node.hasAttribute("data-floe-layout-spacer")
  );
}

function isOnlyLayoutSpacerMutation(mutation: MutationRecord): boolean {
  const changedNodes = [
    ...Array.from(mutation.addedNodes),
    ...Array.from(mutation.removedNodes),
  ];
  return (
    changedNodes.length > 0 &&
    changedNodes.every((node) => isLayoutSpacerNode(node))
  );
}

export function EditorModeView({ document, mode }: EditorModeViewProps) {
  const layout = getEditorModeLayout(mode);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  const clearPreviewSpacers = useCallback(() => {
    const previewPane = previewPaneRef.current;
    if (!previewPane) return;

    for (const spacer of previewPane.querySelectorAll(
      "[data-floe-layout-spacer]",
    )) {
      spacer.remove();
    }
  }, []);

  const scheduleAlignment = useCallback(() => {
    if (!layout.split) return;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;

      const editor = editorRef.current;
      const previewPane = previewPaneRef.current;
      if (!editor || !previewPane) return;

      editor.setAlignmentSpacers([]);
      clearPreviewSpacers();

      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;

        const currentEditor = editorRef.current;
        const currentPreviewPane = previewPaneRef.current;
        if (!currentEditor || !currentPreviewPane) return;

        const headingByLine = new Map<number, HTMLElement>();
        const anchors = Array.from(
          currentPreviewPane.querySelectorAll<HTMLElement>(HEADING_SELECTOR),
        ).flatMap((heading) => {
          const sourceLine = Number(heading.dataset.floeSourceStart);
          if (!Number.isFinite(sourceLine)) return [];

          const editorTop = currentEditor.getLineTop(sourceLine);
          if (editorTop === null) return [];

          headingByLine.set(sourceLine, heading);
          return [
            {
              sourceLine,
              editorTop,
              previewTop: heading.getBoundingClientRect().top,
            },
          ];
        });

        const plan = planHeadingAlignment(anchors);
        currentEditor.setAlignmentSpacers(plan.editor);

        for (const spacerPlan of plan.preview) {
          const heading = headingByLine.get(spacerPlan.line);
          if (!heading) continue;

          const spacer = document.createElement("div");
          spacer.dataset.floeLayoutSpacer = "";
          spacer.setAttribute("aria-hidden", "true");
          spacer.style.height = `${spacerPlan.height}px`;
          spacer.style.pointerEvents = "none";
          heading.before(spacer);
        }
      });
    });
  }, [clearPreviewSpacers, layout.split]);

  useLayoutEffect(() => {
    if (!layout.split) {
      editorRef.current?.setAlignmentSpacers([]);
      clearPreviewSpacers();
      return;
    }

    const previewPane = previewPaneRef.current;
    if (!previewPane) return;

    const observer = new MutationObserver((mutations) => {
      if (mutations.every(isOnlyLayoutSpacerMutation)) return;
      scheduleAlignment();
    });
    observer.observe(previewPane, { childList: true, subtree: true });

    const handleResize = () => scheduleAlignment();
    const handleLoad = () => scheduleAlignment();
    window.addEventListener("resize", handleResize);
    previewPane.addEventListener("load", handleLoad, true);
    scheduleAlignment();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      previewPane.removeEventListener("load", handleLoad, true);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      editorRef.current?.setAlignmentSpacers([]);
      clearPreviewSpacers();
    };
  }, [clearPreviewSpacers, layout.split, scheduleAlignment]);

  return (
    <div
      className={layout.split ? "editor-view editor-view-split" : "editor-view"}
      data-editor-mode={mode}
    >
      {layout.showEditor ? (
        <div className="editor-view-pane editor-view-source">
          <MarkdownEditor ref={editorRef} document={document} />
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
