import type { EditorMode } from "./editor-mode-preference.js";

export type EditorModeLayout = {
  showEditor: boolean;
  showPreview: boolean;
  split: boolean;
};

export function getEditorModeLayout(mode: EditorMode): EditorModeLayout {
  switch (mode) {
    case "edit":
      return { showEditor: true, showPreview: false, split: false };
    case "split":
      return { showEditor: true, showPreview: true, split: true };
    case "preview":
      return { showEditor: false, showPreview: true, split: false };
  }
}
