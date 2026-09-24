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
        onRestoreDocument: vi.fn(),
      }),
    );

    expect(markup).toContain("Trash is empty");
    expect(markup).toContain("Notes you delete will appear here.");
    expect(markup).not.toContain(">Restore<");
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
        onRestoreDocument: vi.fn(),
      }),
    );

    expect(markup).toContain("Remote deletion");
    expect(markup).toContain(">Restore<");
  });
});
