import { useEffect, useState } from "react";

const STORAGE_KEY = "floe-note-editor-preference";

export const EDITOR_TEXT_SIZE_PX = {
  small: 14,
  default: 16,
  large: 18,
  "extra-large": 20,
} as const;

export const EDITOR_LINE_HEIGHT = {
  compact: 1.45,
  default: 1.62,
  relaxed: 1.8,
} as const;

export const EDITOR_CONTENT_WIDTH_PX = {
  narrow: 680,
  default: 820,
  wide: 1000,
} as const;

export type EditorTextSize = keyof typeof EDITOR_TEXT_SIZE_PX;
export type EditorLineHeight = keyof typeof EDITOR_LINE_HEIGHT;
export type EditorContentWidth = keyof typeof EDITOR_CONTENT_WIDTH_PX;

export type EditorPreference = {
  textSize: EditorTextSize;
  lineHeight: EditorLineHeight;
  contentWidth: EditorContentWidth;
};

export const DEFAULT_EDITOR_PREFERENCE: EditorPreference = {
  textSize: "default",
  lineHeight: "default",
  contentWidth: "default",
};

export function readEditorPreference(): EditorPreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_EDITOR_PREFERENCE };

    const parsed = JSON.parse(stored) as unknown;
    return normalizeEditorPreference(parsed);
  } catch {
    return { ...DEFAULT_EDITOR_PREFERENCE };
  }
}

export function writeEditorPreference(preference: EditorPreference): void {
  const normalized = normalizeEditorPreference(preference);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Editor appearance preferences are best-effort only.
  }
}

export function clearEditorPreference(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Editor appearance preferences are best-effort only.
  }

  const root = document.documentElement;
  root.style.removeProperty("--editor-font-size");
  root.style.removeProperty("--editor-line-height");
  root.style.removeProperty("--editor-content-width");
}

export function applyEditorPreference(preference: EditorPreference): void {
  const normalized = normalizeEditorPreference(preference);
  const root = document.documentElement;

  root.style.setProperty(
    "--editor-font-size",
    `${EDITOR_TEXT_SIZE_PX[normalized.textSize]}px`,
  );
  root.style.setProperty(
    "--editor-line-height",
    String(EDITOR_LINE_HEIGHT[normalized.lineHeight]),
  );
  root.style.setProperty(
    "--editor-content-width",
    `${EDITOR_CONTENT_WIDTH_PX[normalized.contentWidth]}px`,
  );
}

export function normalizeEditorPreference(value: unknown): EditorPreference {
  const candidate = isRecord(value) ? value : {};

  return {
    textSize: isEditorTextSize(candidate.textSize)
      ? candidate.textSize
      : DEFAULT_EDITOR_PREFERENCE.textSize,
    lineHeight: isEditorLineHeight(candidate.lineHeight)
      ? candidate.lineHeight
      : DEFAULT_EDITOR_PREFERENCE.lineHeight,
    contentWidth: isEditorContentWidth(candidate.contentWidth)
      ? candidate.contentWidth
      : DEFAULT_EDITOR_PREFERENCE.contentWidth,
  };
}

export function useEditorPreference(): [
  EditorPreference,
  (preference: EditorPreference) => void,
] {
  const [preference, setPreference] = useState<EditorPreference>(
    readEditorPreference,
  );

  useEffect(() => {
    applyEditorPreference(preference);
    writeEditorPreference(preference);
  }, [preference]);

  return [preference, setPreference];
}

function isEditorTextSize(value: unknown): value is EditorTextSize {
  return (
    typeof value === "string" &&
    Object.hasOwn(EDITOR_TEXT_SIZE_PX, value)
  );
}

function isEditorLineHeight(value: unknown): value is EditorLineHeight {
  return (
    typeof value === "string" &&
    Object.hasOwn(EDITOR_LINE_HEIGHT, value)
  );
}

function isEditorContentWidth(value: unknown): value is EditorContentWidth {
  return (
    typeof value === "string" &&
    Object.hasOwn(EDITOR_CONTENT_WIDTH_PX, value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
