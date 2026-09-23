import { createDocumentId } from "@floe-note/domain";
import { NoteDocument } from "@floe-note/document";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorModeView } from "../src/EditorModeView.js";
import { getEditorModeLayout } from "../src/editor-mode-layout.js";
import {
  normalizeEditorMode,
  readEditorModePreference,
  writeEditorModePreference,
} from "../src/editor-mode-preference.js";
import { getMarkdownPreviewSource } from "../src/MarkdownPreview.js";

describe("editor modes", () => {
  it("renders only the source editor in Edit mode", () => {
    const document = NoteDocument.create(createDocumentId(), "Edit", 100);
    const markup = renderToStaticMarkup(
      createElement(EditorModeView, { document, mode: "edit" }),
    );

    expect(getEditorModeLayout("edit")).toEqual({
      showEditor: true,
      showPreview: false,
      split: false,
      livePreview: false,
    });
    expect(markup).toContain('data-editor-mode="edit"');
    expect(markup).toContain("editor-view-source");
    expect(markup).not.toContain("editor-view-preview");
  });

  it("shows a single decorated editor in Live mode", () => {
    expect(getEditorModeLayout("live")).toEqual({
      showEditor: true,
      showPreview: false,
      split: false,
      livePreview: true,
    });
  });

  it("shows only the preview in Preview mode", () => {
    expect(getEditorModeLayout("preview")).toEqual({
      showEditor: false,
      showPreview: true,
      split: false,
      livePreview: false,
    });
  });

  it("shows source and preview together in Split mode", () => {
    expect(getEditorModeLayout("split")).toEqual({
      showEditor: true,
      showPreview: true,
      split: true,
      livePreview: false,
    });
  });

  it("reflects a local body edit in the preview source", async () => {
    const document = NoteDocument.create(createDocumentId(), "Local", 100);
    const binding = document.getEditorBinding();

    binding.getText(binding.doc).insert(0, "# Local edit");
    binding.doc.commit();
    await Promise.resolve();

    expect(getMarkdownPreviewSource(document)).toBe("# Local edit");
  });

  it("reflects a remote CRDT body update in the preview source", async () => {
    const id = createDocumentId();
    const source = NoteDocument.create(id, "Source", 100);
    const target = NoteDocument.fromSnapshot(id, source.exportSnapshot());
    const binding = source.getEditorBinding();

    binding.getText(binding.doc).insert(0, "Remote edit");
    binding.doc.commit();
    await Promise.resolve();

    target.importUpdate(source.exportUpdate());

    expect(getMarkdownPreviewSource(target)).toBe("Remote edit");
  });

  it("does not change document state when the view mode changes", async () => {
    const document = NoteDocument.create(createDocumentId(), "Stable", 100);
    document.addTag("metadata");
    document.setTitle("Renamed");

    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "Persistent body");
    binding.doc.commit();
    await Promise.resolve();

    for (const mode of ["edit", "live", "split", "preview"] as const) {
      getEditorModeLayout(mode);
      expect(document.title).toBe("Renamed");
      expect(document.tags).toEqual(["metadata"]);
      expect(document.bodyText).toBe("Persistent body");
    }
  });

  it("uses the same device-local mode across note switching", async () => {
    const first = NoteDocument.create(createDocumentId(), "First", 100);
    const second = NoteDocument.create(createDocumentId(), "Second", 100);
    const firstBinding = first.getEditorBinding();
    const secondBinding = second.getEditorBinding();

    firstBinding.getText(firstBinding.doc).insert(0, "First body");
    firstBinding.doc.commit();
    secondBinding.getText(secondBinding.doc).insert(0, "Second body");
    secondBinding.doc.commit();
    await Promise.resolve();

    const mode = normalizeEditorMode("split");
    expect(getEditorModeLayout(mode).split).toBe(true);
    expect(getMarkdownPreviewSource(first)).toBe("First body");
    expect(getMarkdownPreviewSource(second)).toBe("Second body");
  });

  it("normalizes invalid persisted modes to Edit", () => {
    expect(normalizeEditorMode("edit")).toBe("edit");
    expect(normalizeEditorMode("live")).toBe("live");
    expect(normalizeEditorMode("split")).toBe("split");
    expect(normalizeEditorMode("preview")).toBe("preview");
    expect(normalizeEditorMode("unknown")).toBe("edit");
    expect(normalizeEditorMode(null)).toBe("edit");
  });

  it("reads and writes the mode as a device-local preference", () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const previousWindow = globalThis.window;
    vi.stubGlobal("window", { localStorage });

    try {
      expect(readEditorModePreference()).toBe("edit");

      writeEditorModePreference("split");

      expect(readEditorModePreference()).toBe("split");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "floe-note-editor-mode",
        "split",
      );
    } finally {
      vi.unstubAllGlobals();
      if (previousWindow !== undefined) {
        vi.stubGlobal("window", previousWindow);
      }
    }
  });
});
