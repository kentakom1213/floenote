import type { EditorMode } from "./editor-mode-preference.js";

export type EditorModeLayout = {
  showEditor: boolean;
  showPreview: boolean;
  showLive: boolean;
  split: boolean;
};

export function getEditorModeLayout(mode: EditorMode): EditorModeLayout {
  switch (mode) {
    case "edit":
      return {
        showEditor: true,
        showPreview: false,
        showLive: false,
        split: false,
      };
    case "split":
      return {
        showEditor: true,
        showPreview: true,
        showLive: false,
        split: true,
      };
    case "preview":
      return {
        showEditor: false,
        showPreview: true,
        showLive: false,
        split: false,
      };
    case "live":
      return {
        showEditor: false,
        showPreview: false,
        showLive: true,
        split: false,
      };
  }
}
