import { NoteDocument, NoteProject } from "@floe-note/document";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TrashView } from "../src/TrashView.js";

describe("TrashView", () => {
  it("renders an empty Trash state", () => {
    const project = NoteProject.create();
    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project,
        selectedDocumentId: null,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
      }),
    );

    expect(markup).toContain("Trash is empty");
    expect(markup).toContain("Notes you delete will appear here.");
    expect(markup).not.toContain(">Restore<");
  });

  it("renders a read-only preview for a selected deleted note", async () => {
    const project = NoteProject.create();
    const document = project.createDocument("Deleted preview");
    document.setTags(["research", "draft"]);
    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "# Preview body");
    binding.doc.commit();
    await Promise.resolve();
    project.deleteDocument(document.id);

    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project,
        selectedDocumentId: document.id,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
      }),
    );

    expect(markup).toContain("Deleted preview");
    expect(markup).toContain("research");
    expect(markup).toContain("draft");
    expect(markup).toContain("Preview body");
    expect(markup).toContain(">Restore<");
    expect(markup).not.toContain("Add tag");
  });

  it("reflects a remote manifest delete in the Trash UI", () => {
    const source = NoteProject.create();
    const document = source.createDocument("Remote deletion");
    const targetDocument = NoteDocument.fromSnapshot(
      document.id,
      document.exportSnapshot(),
    );
    const target = NoteProject.fromSnapshot(
      source.id,
      source.exportManifestSnapshot(),
      [targetDocument],
    );

    source.deleteDocument(document.id);
    target.importManifestUpdate(source.exportManifestUpdate());

    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project: target,
        selectedDocumentId: null,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
      }),
    );

    expect(markup).toContain("Remote deletion");
    expect(markup).toContain(">Restore<");
  });
});
