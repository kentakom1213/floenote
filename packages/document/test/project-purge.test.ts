import { describe, expect, it } from "vitest";

import { NoteDocument } from "../src/document.js";
import { NoteProject } from "../src/project.js";

describe("NoteProject permanent deletion", () => {
  it("purges a deleted document and removes its content from every user-facing view", () => {
    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Sensitive note",
      body: "# Secret\n",
      createdAt: 100,
      updatedAt: 200,
      tags: ["private"],
    });

    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    expect(project.isDocumentPurged(document.id)).toBe(true);
    expect(project.listDocuments()).toEqual([]);
    expect(project.listDeletedDocuments()).toEqual([]);
    expect(project.getDocument(document.id)).toBeUndefined();
    expect(project.getDeletedDocument(document.id)).toBeUndefined();
    expect(project.getAllDocuments()).toEqual([]);
  });

  it("does not purge an active document directly", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Active");

    project.purgeDocument(document.id);

    expect(project.isDocumentPurged(document.id)).toBe(false);
    expect(project.getDocument(document.id)).toBe(document);
    expect(project.getAllDocuments()).toEqual([document]);
  });

  it("does not restore a purged document", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Gone");
    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    project.restoreDocument(document.id);

    expect(project.isDocumentPurged(document.id)).toBe(true);
    expect(project.getDocument(document.id)).toBeUndefined();
    expect(project.getDeletedDocument(document.id)).toBeUndefined();
    expect(project.getAllDocuments()).toEqual([]);
  });

  it("persists the purge tombstone across a manifest snapshot round-trip", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Persisted purge");
    const staleDocument = NoteDocument.fromSnapshot(
      document.id,
      document.exportSnapshot(),
    );
    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    const restored = NoteProject.fromSnapshot(
      project.id,
      project.exportManifestSnapshot(),
      [staleDocument],
    );

    expect(restored.isDocumentPurged(document.id)).toBe(true);
    expect(restored.getAllDocuments()).toEqual([]);
    expect(restored.listDocuments()).toEqual([]);
    expect(restored.listDeletedDocuments()).toEqual([]);
  });

  it("does not let a stale active status resurrect a purged document", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Concurrent");
    const purging = cloneProject(base);
    const stale = cloneProject(base);

    purging.deleteDocument(document.id);
    purging.purgeDocument(document.id);

    stale.deleteDocument(document.id);
    stale.restoreDocument(document.id);

    purging.importManifestUpdate(stale.exportManifestUpdate());

    expect(purging.isDocumentPurged(document.id)).toBe(true);
    expect(purging.listDocuments()).toEqual([]);
    expect(purging.listDeletedDocuments()).toEqual([]);
    expect(purging.getAllDocuments()).toEqual([]);
  });

  it("does not let a stale deleted status resurrect a purged document", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Concurrent");
    const purging = cloneProject(base);
    const stale = cloneProject(base);

    purging.deleteDocument(document.id);
    purging.purgeDocument(document.id);
    stale.deleteDocument(document.id);

    purging.importManifestUpdate(stale.exportManifestUpdate());

    expect(purging.isDocumentPurged(document.id)).toBe(true);
    expect(purging.listDocuments()).toEqual([]);
    expect(purging.listDeletedDocuments()).toEqual([]);
    expect(purging.getAllDocuments()).toEqual([]);
  });

  it("resolves concurrent restore versus purge semantically to purge", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Conflict");
    base.deleteDocument(document.id);

    const purging = cloneProject(base);
    const restoring = cloneProject(base);

    purging.purgeDocument(document.id);
    restoring.restoreDocument(document.id);

    const purgeUpdate = purging.exportManifestUpdate();
    const restoreUpdate = restoring.exportManifestUpdate();
    purging.importManifestUpdate(restoreUpdate);
    restoring.importManifestUpdate(purgeUpdate);

    for (const project of [purging, restoring]) {
      expect(project.isDocumentPurged(document.id)).toBe(true);
      expect(project.listDocuments()).toEqual([]);
      expect(project.listDeletedDocuments()).toEqual([]);
      expect(project.getDocument(document.id)).toBeUndefined();
      expect(project.getDeletedDocument(document.id)).toBeUndefined();
      expect(project.getAllDocuments()).toEqual([]);
    }
  });

  it("ignores a document update when the purge tombstone is already known", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Stale update");
    const update = document.exportUpdate();

    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    const imported = project.importDocumentUpdate(document.id, update);

    expect(imported).toBeUndefined();
    expect(project.getAllDocuments()).toEqual([]);
  });

  it("removes stale content when the purge manifest arrives after a document update", () => {
    const source = NoteProject.create();
    const document = source.createDocument("Stale first");
    const target = NoteProject.create(source.id);

    const imported = target.importDocumentUpdate(
      document.id,
      document.exportUpdate(),
    );
    expect(imported?.title).toBe("Stale first");
    expect(target.getAllDocuments()).toHaveLength(1);

    source.deleteDocument(document.id);
    source.purgeDocument(document.id);
    target.importManifestUpdate(source.exportManifestUpdate());

    expect(target.isDocumentPurged(document.id)).toBe(true);
    expect(target.getAllDocuments()).toEqual([]);
  });

  it("keeps ordinary active -> deleted -> restore behavior unchanged", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Restorable");

    project.deleteDocument(document.id);
    expect(project.getDeletedDocument(document.id)).toBe(document);

    project.restoreDocument(document.id);
    expect(project.getDocument(document.id)).toBe(document);
    expect(project.isDocumentPurged(document.id)).toBe(false);
  });
});

function cloneProject(source: NoteProject): NoteProject {
  return NoteProject.fromSnapshot(
    source.id,
    source.exportManifestSnapshot(),
    source.getAllDocuments().map((document) =>
      NoteDocument.fromSnapshot(document.id, document.exportSnapshot()),
    ),
  );
}
