import { describe, expect, it, vi } from "vitest";

import { NoteProject } from "@floe-note/document";

import {
  filterLoadableDocumentRows,
  reconcileDocumentSubscriptions,
  shouldPersistDocumentReference,
  staleDocumentRowIds,
} from "../src/document-persistence-reconciliation.js";

describe("purged document persistence reconciliation", () => {
  it("marks a purged encrypted document row as stale so persistence deletes it", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Purge row");
    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    const rows = [
      {
        documentId: document.id,
        encryptedSnapshot: Uint8Array.of(1, 2, 3),
      },
    ];

    expect(staleDocumentRowIds(project.getAllDocuments(), rows)).toEqual([
      document.id,
    ]);
  });

  it("keeps deleted-but-restorable document rows", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Trash row");
    project.deleteDocument(document.id);

    const rows = [{ documentId: document.id }];

    expect(staleDocumentRowIds(project.getAllDocuments(), rows)).toEqual([]);
  });

  it("ignores a stale encrypted row when the manifest says the document is purged", () => {
    const source = NoteProject.create();
    const document = source.createDocument("Stale row");
    source.deleteDocument(document.id);
    source.purgeDocument(document.id);

    const reloadedManifest = NoteProject.fromSnapshot(
      source.id,
      source.exportManifestSnapshot(),
      [],
    );
    const rows = [
      {
        documentId: document.id,
        encryptedSnapshot: Uint8Array.of(9, 9, 9),
      },
    ];

    expect(filterLoadableDocumentRows(reloadedManifest, rows)).toEqual([]);
  });

  it("still loads rows for active and deleted documents", () => {
    const project = NoteProject.create();
    const active = project.createDocument("Active");
    const deleted = project.createDocument("Deleted");
    project.deleteDocument(deleted.id);

    const rows = [
      { documentId: active.id },
      { documentId: deleted.id },
    ];

    expect(filterLoadableDocumentRows(project, rows)).toEqual(rows);
  });

  it("detaches persistence subscriptions when the Workspace document set shrinks", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Subscribed");
    const unsubscribe = vi.fn();
    const subscriptions = new Map<string, () => void>([
      [document.id, unsubscribe],
    ]);

    project.deleteDocument(document.id);
    project.purgeDocument(document.id);
    reconcileDocumentSubscriptions(
      project.getAllDocuments(),
      subscriptions,
      () => {
        throw new Error("Purged document must not be reattached");
      },
    );

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(subscriptions.has(document.id)).toBe(false);
  });

  it("rejects queued stale-object persistence after purge", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Queued");

    expect(shouldPersistDocumentReference(project, document)).toBe(true);

    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    expect(shouldPersistDocumentReference(project, document)).toBe(false);
  });

  it("prevents a stale object edit from firing a detached persistence subscription", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Detached");
    const subscriptions = new Map<string, () => void>();
    const persist = vi.fn();

    const attach = (candidate: typeof document) => {
      const unsubscribe = candidate.subscribe(() => {
        if (shouldPersistDocumentReference(project, candidate)) {
          persist(candidate.id);
        }
      });
      subscriptions.set(candidate.id, unsubscribe);
    };

    reconcileDocumentSubscriptions(
      project.getAllDocuments(),
      subscriptions,
      attach,
    );

    project.deleteDocument(document.id);
    project.purgeDocument(document.id);
    reconcileDocumentSubscriptions(
      project.getAllDocuments(),
      subscriptions,
      attach,
    );

    document.setTitle("Stale edit");

    expect(subscriptions.has(document.id)).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});
