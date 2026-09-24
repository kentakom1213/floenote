import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteDocument } from "../src/document.js";
import { NoteProject } from "../src/project.js";

describe("NoteProject Trash", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves active documents to Trash without removing their identity", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Archived note");

    project.deleteDocument(document.id);

    expect(project.listDocuments()).toEqual([]);
    expect(project.listDeletedDocuments()).toEqual([
      { id: document.id, title: "Archived note" },
    ]);
    expect(project.getDocument(document.id)).toBeUndefined();
    expect(project.getDeletedDocument(document.id)).toBe(document);
  });

  it("restores the same document with body and metadata unchanged", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(100);
    const project = NoteProject.create();
    const document = project.createDocument("Original");

    now.mockReturnValue(200);
    document.setTitle("Restored note");
    document.setTags(["graph", "draft"]);

    now.mockReturnValue(300);
    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "# Body");
    binding.doc.commit();
    await Promise.resolve();

    const before = {
      id: document.id,
      title: document.title,
      body: document.bodyText,
      tags: [...document.tags],
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };

    now.mockReturnValue(999);
    project.deleteDocument(document.id);
    project.restoreDocument(document.id);

    const restored = project.getDocument(document.id);
    expect(restored).toBe(document);
    expect({
      id: restored?.id,
      title: restored?.title,
      body: restored?.bodyText,
      tags: restored ? [...restored.tags] : [],
      createdAt: restored?.createdAt,
      updatedAt: restored?.updatedAt,
    }).toEqual(before);
    expect(project.listDeletedDocuments()).toEqual([]);
  });

  it("synchronizes delete and restore through manifest updates", () => {
    const source = NoteProject.create();
    const document = source.createDocument("Synced");
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

    expect(target.getDocument(document.id)).toBeUndefined();
    expect(target.getDeletedDocument(document.id)).toBe(targetDocument);

    source.restoreDocument(document.id);
    target.importManifestUpdate(source.exportManifestUpdate());

    expect(target.getDocument(document.id)).toBe(targetDocument);
    expect(target.listDeletedDocuments()).toEqual([]);
  });

  it("preserves deleted state across a manifest snapshot round-trip", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Persisted");
    project.deleteDocument(document.id);

    const restoredDocument = NoteDocument.fromSnapshot(
      document.id,
      document.exportSnapshot(),
    );
    const restoredProject = NoteProject.fromSnapshot(
      project.id,
      project.exportManifestSnapshot(),
      [restoredDocument],
    );

    expect(restoredProject.listDocuments()).toEqual([]);
    expect(restoredProject.listDeletedDocuments()).toEqual([
      { id: document.id, title: "Persisted" },
    ]);
    expect(restoredProject.getDeletedDocument(document.id)).toBe(
      restoredDocument,
    );
  });
});
