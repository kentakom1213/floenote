import type { EditorMode } from "./editor-mode-preference.js";

export type EditorModeLayout = {
  showEditor: boolean;
  showPreview: boolean;
  split: boolean;
  live: boolean;
};

export function getEditorModeLayout(mode: EditorMode): EditorModeLayout {
  switch (mode) {
    case "edit":
      return {
        showEditor: true,
        showPreview: false,
        split: false,
        live: false,
      };
    case "split":
      return {
        showEditor: true,
        showPreview: true,
        split: true,
        live: false,
      };
    case "preview":
      return {
        showEditor: false,
        showPreview: true,
        split: false,
        live: false,
      };
    case "live":
      return {
        showEditor: true,
        showPreview: false,
        split: false,
        live: true,
      };
  }
}
