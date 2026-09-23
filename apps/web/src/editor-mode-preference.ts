const STORAGE_KEY = "floe-note-editor-mode";

export type EditorMode = "edit" | "split" | "preview";

export function readEditorModePreference(): EditorMode {
  try {
    return normalizeEditorMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "edit";
  }
}

export function writeEditorModePreference(mode: EditorMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Editor view preferences are best-effort only.
  }
}

export function normalizeEditorMode(value: unknown): EditorMode {
  return value === "split" || value === "preview" || value === "edit"
    ? value
    : "edit";
}
