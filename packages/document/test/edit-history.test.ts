import { createDeviceId, createDocumentId } from "@floe-note/domain";
import { UndoManager } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";

import { NoteDocument } from "../src/document.js";
import { NoteProject } from "../src/project.js";

function replaceBody(document: NoteDocument, value: string): void {
  const binding = document.getEditorBinding();
  const text = binding.getText(binding.doc);
  const current = text.toString();
  text.splice(0, current.length, value);
  binding.doc.commit();
}

function createEditorUndoManager(document: NoteDocument): UndoManager {
  const binding = document.getEditorBinding();
  return new UndoManager(binding.doc, {
    mergeInterval: 0,
    excludeOriginPrefixes: [...binding.undoExcludeOriginPrefixes],
  });
}

function cloneProject(source: NoteProject): NoteProject {
  return NoteProject.fromSnapshot(
    source.id,
    source.exportManifestSnapshot(),
    source.getAllDocuments().map((document) =>
      NoteDocument.fromSnapshot(document.id, document.exportSnapshot()),
    ),
  );
}

describe("NoteProject edit history", () => {
  it("stores frontiers checkpoints and reconstructs historical note state", () => {
    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Draft",
      body: "first",
      createdAt: 100,
      updatedAt: 100,
      tags: ["draft"],
    });

    const first = project.createEditHistoryCheckpoint(document.id, {
      createdAt: 200,
    });
    expect(first).not.toBeNull();

    document.setTitle("Final");
    document.setTags(["final"]);
    replaceBody(document, "second");

    const second = project.createEditHistoryCheckpoint(document.id, {
      createdAt: 300,
    });
    expect(second).not.toBeNull();

    expect(
      project.listEditHistoryCheckpoints(document.id).map((checkpoint) => ({
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
      })),
    ).toEqual([
      { id: second?.id, createdAt: 300 },
      { id: first?.id, createdAt: 200 },
    ]);

    const historical = first
      ? project.createHistoricalDocument(first.id)
      : null;
    expect(historical?.id).toBe(document.id);
    expect(historical?.title).toBe("Draft");
    expect(historical?.tags).toEqual(["draft"]);
    expect(historical?.bodyText).toBe("first");
  });

  it("does not create duplicate checkpoints for the same Loro version", () => {
    const project = NoteProject.create();
    const document = project.createDocument("One");

    expect(
      project.createEditHistoryCheckpoint(document.id, { createdAt: 100 }),
    ).not.toBeNull();
    expect(
      project.createEditHistoryCheckpoint(document.id, { createdAt: 200 }),
    ).toBeNull();
    expect(project.listEditHistoryCheckpoints(document.id)).toHaveLength(1);
  });

  it("persists checkpoint metadata through a manifest snapshot round-trip", () => {
    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Persisted",
      body: "snapshot body",
      createdAt: 100,
      updatedAt: 100,
      tags: ["history"],
    });
    const deviceId = createDeviceId();
    const checkpoint = project.createEditHistoryCheckpoint(document.id, {
      createdAt: 200,
      createdByDeviceId: deviceId,
    });
    expect(checkpoint).not.toBeNull();

    const restoredDocument = NoteDocument.fromSnapshot(
      document.id,
      document.exportSnapshot(),
    );
    const restored = NoteProject.fromSnapshot(
      project.id,
      project.exportManifestSnapshot(),
      [restoredDocument],
    );

    const checkpoints = restored.listEditHistoryCheckpoints(document.id);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.id).toBe(checkpoint?.id);
    expect(checkpoints[0]?.frontiers).toEqual(checkpoint?.frontiers);
    expect(checkpoints[0]?.createdByDeviceId).toBe(deviceId);

    const historical = checkpoint
      ? restored.createHistoricalDocument(checkpoint.id)
      : null;
    expect(historical?.bodyText).toBe("snapshot body");
  });

  it("synchronizes checkpoint metadata through manifest updates", () => {
    const source = NoteProject.create();
    const document = source.createDocumentWithInitialState({
      title: "Shared",
      body: "historical",
      createdAt: 100,
      updatedAt: 100,
      tags: ["sync"],
    });
    const target = NoteProject.fromSnapshot(
      source.id,
      source.exportManifestSnapshot(),
      [NoteDocument.fromSnapshot(document.id, document.exportSnapshot())],
    );

    const checkpoint = source.createEditHistoryCheckpoint(document.id, {
      createdAt: 200,
    });
    expect(checkpoint).not.toBeNull();

    target.importManifestUpdate(source.exportManifestUpdate());

    const received = target.listEditHistoryCheckpoints(document.id);
    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe(checkpoint?.id);

    const historical = received[0]
      ? target.createHistoricalDocument(received[0].id)
      : null;
    expect(historical?.title).toBe("Shared");
    expect(historical?.bodyText).toBe("historical");
    expect(historical?.tags).toEqual(["sync"]);
  });

  it("retains concurrent checkpoints from offline devices", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Base");
    const left = cloneProject(base);
    const right = cloneProject(base);

    left.getDocument(document.id)?.setTitle("Left");
    right.getDocument(document.id)?.setTitle("Right");

    const leftCheckpoint = left.createEditHistoryCheckpoint(document.id, {
      createdAt: 200,
    });
    const rightCheckpoint = right.createEditHistoryCheckpoint(document.id, {
      createdAt: 300,
    });

    left.importManifestUpdate(right.exportManifestUpdate());
    right.importManifestUpdate(left.exportManifestUpdate());

    for (const project of [left, right]) {
      expect(
        project
          .listEditHistoryCheckpoints(document.id)
          .map((checkpoint) => checkpoint.id),
      ).toEqual([rightCheckpoint?.id, leftCheckpoint?.id]);
    }
  });

  it("restores historical content as a new undoable current edit", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(100);

    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Old title",
      body: "old body",
      createdAt: 10,
      updatedAt: 10,
      tags: ["old"],
    });
    const oldCheckpoint = project.createEditHistoryCheckpoint(document.id, {
      createdAt: 20,
    });
    expect(oldCheckpoint).not.toBeNull();

    document.setTitle("Current title");
    document.setTags(["current"]);
    replaceBody(document, "current body");
    await Promise.resolve();

    const undoManager = createEditorUndoManager(document);
    now.mockReturnValue(200);

    const restoringDeviceId = createDeviceId();
    const restored = oldCheckpoint
      ? project.restoreEditHistoryCheckpoint(oldCheckpoint.id, {
          createdByDeviceId: restoringDeviceId,
        })
      : null;

    expect(restored?.restoreSourceCheckpointId).toBe(oldCheckpoint?.id);
    expect(restored?.createdAt).toBe(200);
    expect(restored?.createdByDeviceId).toBe(restoringDeviceId);
    expect(
      project.listEditHistoryCheckpoints(document.id)[0]?.id,
    ).toBe(restored?.id);
    expect(project.getDocument(document.id)).toBe(document);
    expect(document.title).toBe("Old title");
    expect(document.tags).toEqual(["old"]);
    expect(document.bodyText).toBe("old body");
    expect(document.createdAt).toBe(10);
    expect(document.updatedAt).toBe(200);

    expect(undoManager.undo()).toBe(true);
    await Promise.resolve();

    expect(document.title).toBe("Current title");
    expect(document.tags).toEqual(["current"]);
    expect(document.bodyText).toBe("current body");
  });

  it("preserves checkpoints in Trash and removes them permanently on purge", () => {
    const project = NoteProject.create();
    const document = project.createDocument("History");
    project.createEditHistoryCheckpoint(document.id, { createdAt: 100 });

    project.deleteDocument(document.id);
    expect(project.listEditHistoryCheckpoints(document.id)).toHaveLength(1);

    project.purgeDocument(document.id);
    expect(project.listEditHistoryCheckpoints(document.id)).toEqual([]);
    expect(project.isDocumentPurged(document.id)).toBe(true);
  });

  it("does not let stale checkpoint metadata survive a purge tombstone", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Concurrent purge");
    const purging = cloneProject(base);
    const stale = cloneProject(base);

    purging.deleteDocument(document.id);
    purging.purgeDocument(document.id);

    stale.getDocument(document.id)?.setTitle("Stale edit");
    stale.createEditHistoryCheckpoint(document.id, { createdAt: 200 });

    purging.importManifestUpdate(stale.exportManifestUpdate());

    expect(purging.isDocumentPurged(document.id)).toBe(true);
    expect(purging.listEditHistoryCheckpoints(document.id)).toEqual([]);
    expect(purging.getAllDocuments()).toEqual([]);
  });

  it("can create a detached historical view without changing the live document", () => {
    const document = NoteDocument.createWithInitialState(createDocumentId(), {
      title: "Before",
      body: "before",
      createdAt: 100,
      updatedAt: 100,
      tags: [],
    });
    const frontiers = document.captureHistoryFrontiers();

    document.setTitle("After");
    replaceBody(document, "after");

    const historical = document.createHistoricalView(frontiers);

    expect(historical).not.toBeNull();
    expect(historical?.title).toBe("Before");
    expect(historical?.bodyText).toBe("before");
    expect(document.title).toBe("After");
    expect(document.bodyText).toBe("after");
  });
});
