import type { EditorMode } from "./editor-mode-preference.js";

export type EditorModeLayout = {
  showEditor: boolean;
  showPreview: boolean;
  split: boolean;
  livePreview: boolean;
};

export function getEditorModeLayout(mode: EditorMode): EditorModeLayout {
  switch (mode) {
    case "edit":
      return {
        showEditor: true,
        showPreview: false,
        split: false,
        livePreview: false,
      };
    case "live":
      return {
        showEditor: true,
        showPreview: false,
        split: false,
        livePreview: true,
      };
    case "split":
      return {
        showEditor: true,
        showPreview: true,
        split: true,
        livePreview: false,
      };
    case "preview":
      return {
        showEditor: false,
        showPreview: true,
        split: false,
        livePreview: false,
      };
  }
}
