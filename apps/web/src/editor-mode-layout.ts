import type { EditorMode } from "./editor-mode-preference.js";

export type EditorModeLayout = {
  showEditor: boolean;
  showPreview: boolean;
  split: boolean;\n  livePreview: boolean;
};

export function getEditorModeLayout(mode: EditorMode): EditorModeLayout {
  switch (mode) {
    case "edit":
      return {\n        showEditor: true,\n        showPreview: false,\n        split: false,\n        livePreview: false,\n      };
    case "live":\n      return {\n        showEditor: true,\n        showPreview: false,\n        split: false,\n        livePreview: true,\n      };\n    case "split":
      return {\n        showEditor: true,\n        showPreview: true,\n        split: true,\n        livePreview: false,\n      };
    case "preview":
      return {\n        showEditor: false,\n        showPreview: true,\n        split: false,\n        livePreview: false,\n      };
  }
}
