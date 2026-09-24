import {
  NoteDocument,
  NoteProject,
} from "@floe-note/document";
import type { Transport } from "@floe-note/transport";
import { describe, expect, it } from "vitest";

import { decodeSyncMessage, ProjectSyncEngine } from "../src/index.js";

class MemoryTransport implements Transport {
  #peer: MemoryTransport | null = null;
  readonly #handlers = new Set<(data: Uint8Array) => void>();
  readonly sent: Uint8Array[] = [];
  #closed = false;

  connect(peer: MemoryTransport): void {
    this.#peer = peer;
  }

  send(data: Uint8Array): void {
    if (this.#closed) return;
    this.sent.push(data.slice());
    this.#peer?.deliver(data.slice());
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  close(): void {
    this.#closed = true;
    this.#handlers.clear();
  }

  private deliver(data: Uint8Array): void {
    if (this.#closed) return;
    for (const handler of this.#handlers) handler(data.slice());
  }
}

function createTransportPair(): [MemoryTransport, MemoryTransport] {
  const left = new MemoryTransport();
  const right = new MemoryTransport();
  left.connect(right);
  right.connect(left);
  return [left, right];
}

function cloneProject(source: NoteProject): NoteProject {
  const documents = source.getAllDocuments().map((document) =>
    NoteDocument.fromSnapshot(document.id, document.exportSnapshot()),
  );
  return NoteProject.fromSnapshot(
    source.id,
    source.exportManifestSnapshot(),
    documents,
  );
}

describe("ProjectSyncEngine", () => {
  it("synchronizes delete and restore as manifest updates", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Trash sync");

    const left = cloneProject(base);
    const right = cloneProject(base);
    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new ProjectSyncEngine(left, leftTransport);
    const rightEngine = new ProjectSyncEngine(right, rightTransport);

    leftEngine.start();
    rightEngine.start();

    left.deleteDocument(document.id);

    expect(left.getDocument(document.id)).toBeUndefined();
    expect(right.getDocument(document.id)).toBeUndefined();
    expect(right.listDeletedDocuments()).toEqual([
      { id: document.id, title: "Trash sync" },
    ]);

    right.restoreDocument(document.id);

    expect(right.getDocument(document.id)?.id).toBe(document.id);
    expect(left.getDocument(document.id)?.id).toBe(document.id);
    expect(left.listDeletedDocuments()).toEqual([]);

    leftEngine.stop();
    rightEngine.stop();
  });

  it("propagates purge through the ordinary manifest update and removes remote content", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Purge sync");
    const left = cloneProject(base);
    const right = cloneProject(base);
    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new ProjectSyncEngine(left, leftTransport);
    const rightEngine = new ProjectSyncEngine(right, rightTransport);

    leftEngine.start();
    rightEngine.start();

    left.deleteDocument(document.id);
    left.purgeDocument(document.id);

    expect(left.isDocumentPurged(document.id)).toBe(true);
    expect(right.isDocumentPurged(document.id)).toBe(true);
    expect(right.getAllDocuments()).toEqual([]);
    expect(right.listDocuments()).toEqual([]);
    expect(right.listDeletedDocuments()).toEqual([]);

    leftEngine.stop();
    rightEngine.stop();
  });

  it("does not send purged document content in full-state sync", () => {
    const project = NoteProject.create();
    const document = project.createDocument("No full-state body");
    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    const transport = new MemoryTransport();
    const engine = new ProjectSyncEngine(project, transport);
    engine.start();

    const messages = transport.sent.map((data) => decodeSyncMessage(data));
    expect(
      messages.some(
        (message) =>
          message.type === "document-update" &&
          message.documentId === document.id,
      ),
    ).toBe(false);
    expect(
      messages.some((message) => message.type === "manifest-update"),
    ).toBe(true);

    engine.stop();
  });

  it("detaches the local document subscription after purge", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Stale local object");
    const transport = new MemoryTransport();
    const engine = new ProjectSyncEngine(project, transport);
    engine.start();

    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    const sentBeforeStaleEdit = transport.sent.length;
    document.setTitle("Must not be sent");

    expect(transport.sent).toHaveLength(sentBeforeStaleEdit);

    engine.stop();
  });

  it("eventually purges content when an offline stale peer reconnects", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Offline peer");
    const purging = cloneProject(base);
    const stale = cloneProject(base);

    purging.deleteDocument(document.id);
    purging.purgeDocument(document.id);
    stale.renameDocument(document.id, "Edited while offline");

    const [purgingTransport, staleTransport] = createTransportPair();
    const purgingEngine = new ProjectSyncEngine(
      purging,
      purgingTransport,
    );
    const staleEngine = new ProjectSyncEngine(stale, staleTransport);

    purgingEngine.start();
    staleEngine.start();

    expect(purging.isDocumentPurged(document.id)).toBe(true);
    expect(stale.isDocumentPurged(document.id)).toBe(true);
    expect(purging.getAllDocuments()).toEqual([]);
    expect(stale.getAllDocuments()).toEqual([]);

    purgingEngine.stop();
    staleEngine.stop();
  });

  it("converges projects after independent offline edits", () => {
    const base = NoteProject.create();
    const baseDocument = base.createDocument("Base");

    const left = cloneProject(base);
    const right = cloneProject(base);

    left.renameDocument(baseDocument.id, "Renamed on left");
    right.renameDocument(baseDocument.id, "Renamed on right");
    left.createDocument("Left only");
    right.createDocument("Right only");

    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new ProjectSyncEngine(left, leftTransport);
    const rightEngine = new ProjectSyncEngine(right, rightTransport);

    leftEngine.start();
    rightEngine.start();

    const leftSummaries = left
      .listDocuments()
      .map(({ id, title }) => ({ id, title }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const rightSummaries = right
      .listDocuments()
      .map(({ id, title }) => ({ id, title }))
      .sort((a, b) => a.id.localeCompare(b.id));

    expect(rightSummaries).toEqual(leftSummaries);
    expect(leftSummaries.map(({ title }) => title)).toContain("Left only");
    expect(leftSummaries.map(({ title }) => title)).toContain("Right only");
    expect(left.getDocument(baseDocument.id)?.title).toBe(
      right.getDocument(baseDocument.id)?.title,
    );

    leftEngine.stop();
    rightEngine.stop();
  });
});
