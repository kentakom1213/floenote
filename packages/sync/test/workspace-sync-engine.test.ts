import {
  NoteDocument,
  NoteProject,
} from "@floe-note/document";
import type { Transport } from "@floe-note/transport";
import { describe, expect, it, vi } from "vitest";

import {
  decodeSyncMessage,
  encodeSyncMessage,
  WorkspaceSyncEngine,
} from "../src/index.js";

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

describe("WorkspaceSyncEngine", () => {
  it("relays live updates between a remote peer and another local tab", () => {
    const base = NoteProject.create();
    const documentId = base.createDocument("Before sync").id;
    const remote = cloneProject(base);
    const owner = cloneProject(base);
    const follower = cloneProject(base);
    const [remoteTransport, ownerRemoteTransport] = createTransportPair();
    const [ownerLocalTransport, followerTransport] = createTransportPair();
    const engines = [
      new WorkspaceSyncEngine(remote, remoteTransport),
      new WorkspaceSyncEngine(owner, ownerRemoteTransport, {
        relayScope: "remote-peer",
      }),
      new WorkspaceSyncEngine(owner, ownerLocalTransport, {
        relayScope: "local-tab",
      }),
      new WorkspaceSyncEngine(follower, followerTransport),
    ];

    try {
      for (const engine of engines) engine.start();

      const remoteEchoesBefore = ownerRemoteTransport.sent.length;
      remote.getDocument(documentId)?.setTitle("Remote edit");
      expect(owner.getDocument(documentId)?.title).toBe("Remote edit");
      expect(follower.getDocument(documentId)?.title).toBe("Remote edit");
      expect(ownerRemoteTransport.sent).toHaveLength(remoteEchoesBefore);

      follower.getDocument(documentId)?.setTitle("Local tab edit");
      expect(owner.getDocument(documentId)?.title).toBe("Local tab edit");
      expect(remote.getDocument(documentId)?.title).toBe("Local tab edit");

      const remoteNote = remote.createDocument("Remote new note");
      expect(follower.getDocument(remoteNote.id)?.title).toBe("Remote new note");

      const localNote = follower.createDocument("Local tab new note");
      expect(remote.getDocument(localNote.id)?.title).toBe("Local tab new note");
    } finally {
      for (const engine of engines) engine.stop();
    }
  });

  it("acknowledges the document version applied by a remote peer", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Confirmation");
    const left = cloneProject(base);
    const right = cloneProject(base);
    const [leftTransport, rightTransport] = createTransportPair();
    const confirmations: Uint8Array[] = [];
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport, {
      onRemoteDocumentVersionConfirmed: (documentId, frontiers) => {
        if (documentId === document.id) confirmations.push(frontiers);
      },
    });
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport, {
      onRemoteDocumentVersionConfirmed: () => {},
    });

    leftEngine.start();
    rightEngine.start();
    confirmations.length = 0;

    left.getDocument(document.id)?.setTitle("Confirmed remotely");

    expect(right.getDocument(document.id)?.title).toBe("Confirmed remotely");
    expect(confirmations).toHaveLength(1);
    expect(
      left.getDocument(document.id)?.matchesHistoryFrontiers(confirmations[0]!),
    ).toBe(true);

    leftEngine.stop();
    rightEngine.stop();
  });

  it("synchronizes Project tag colors through ordinary manifest updates", () => {
    const base = NoteProject.create();
    const otherProjectId = base.createProject("Other").id;
    const left = cloneProject(base);
    const right = cloneProject(base);
    const projectId = base.listProjects()[0]!.id;
    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport);
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport);

    leftEngine.start();
    rightEngine.start();

    left.setTagColor(projectId, "research", "blue");
    left.setTagColor(otherProjectId, "research", "orange");
    expect(right.resolveTagColor(projectId, "research")).toBe("blue");
    expect(right.resolveTagColor(otherProjectId, "research")).toBe("orange");

    right.setTagColor(projectId, "research", "purple");
    expect(left.resolveTagColor(projectId, "research")).toBe("purple");
    expect(left.resolveTagColor(otherProjectId, "research")).toBe("orange");

    leftEngine.stop();
    rightEngine.stop();
  });

  it("synchronizes delete and restore as manifest updates", () => {
    const base = NoteProject.create();
    const document = base.createDocument("Trash sync");

    const left = cloneProject(base);
    const right = cloneProject(base);
    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport);
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport);

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
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport);
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport);

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
    const engine = new WorkspaceSyncEngine(project, transport);
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
    const engine = new WorkspaceSyncEngine(project, transport);
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
    const purgingEngine = new WorkspaceSyncEngine(
      purging,
      purgingTransport,
    );
    const staleEngine = new WorkspaceSyncEngine(stale, staleTransport);

    purgingEngine.start();
    staleEngine.start();

    expect(purging.isDocumentPurged(document.id)).toBe(true);
    expect(stale.isDocumentPurged(document.id)).toBe(true);
    expect(purging.getAllDocuments()).toEqual([]);
    expect(stale.getAllDocuments()).toEqual([]);

    purgingEngine.stop();
    staleEngine.stop();
  });

  it("synchronizes a task checkbox toggle as an ordinary document update", async () => {
    const base = NoteProject.create();
    const document = base.createDocument("Shared tasks");
    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "- [ ] synced task");
    binding.doc.commit();
    await Promise.resolve();

    const left = cloneProject(base);
    const right = cloneProject(base);
    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport);
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport);

    leftEngine.start();
    rightEngine.start();

    const leftDocument = left.getDocument(document.id);
    const rightDocument = right.getDocument(document.id);
    expect(leftDocument).toBeDefined();
    expect(rightDocument).toBeDefined();

    const source = leftDocument?.bodyText ?? "";
    const sourceStart = source.indexOf("[ ]");
    const lineEnd = source.length;

    expect(
      leftDocument?.toggleTaskMarker({
        sourceStart,
        sourceEnd: sourceStart + 3,
        lineStart: 0,
        lineEnd,
        sourceLine: source,
        sourceMarker: "[ ]",
        checked: true,
      }),
    ).toBe(true);

    await Promise.resolve();

    expect(leftDocument?.bodyText).toBe("- [x] synced task");
    expect(rightDocument?.bodyText).toBe("- [x] synced task");

    const taskMessages = leftTransport.sent
      .map((data) => decodeSyncMessage(data))
      .filter(
        (message) =>
          message.type === "document-update" &&
          message.documentId === document.id,
      );
    expect(taskMessages.length).toBeGreaterThan(0);

    leftEngine.stop();
    rightEngine.stop();
  });

  it("converges Workspaces after independent offline edits", () => {
    const base = NoteProject.create();
    const baseDocument = base.createDocument("Base");

    const left = cloneProject(base);
    const right = cloneProject(base);

    left.renameDocument(baseDocument.id, "Renamed on left");
    right.renameDocument(baseDocument.id, "Renamed on right");
    left.createDocument("Left only");
    right.createDocument("Right only");

    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport);
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport);

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

  it("converges Project creation, rename, archive, reopen, and Note moves through manifest updates", () => {
    const base = NoteProject.create();
    const notes = base.listProjects()[0]!;
    const note = base.createDocument("Move me", notes.id);
    const left = cloneProject(base);
    const right = cloneProject(base);
    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport);
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport);
    leftEngine.start();
    rightEngine.start();

    const messageCount = leftTransport.sent.length;
    const research = left.createProject("Research");
    left.renameWorkspaceProject(research.id, "Renamed research");
    left.archiveProject(research.id);
    expect(right.getProject(research.id)).toMatchObject({
      name: "Renamed research",
      status: "archived",
    });
    right.reopenProject(research.id);
    left.moveDocument(note.id, research.id);

    expect(left.listProjects()).toEqual(right.listProjects());
    expect(left.getDocumentProjectId(note.id)).toBe(research.id);
    expect(right.getDocumentProjectId(note.id)).toBe(research.id);
    expect(right.getDocument(note.id)?.title).toBe("Move me");
    const projectMessages = leftTransport.sent
      .slice(messageCount)
      .map(decodeSyncMessage);
    expect(projectMessages.length).toBeGreaterThan(0);
    expect(projectMessages.every((message) => message.type === "manifest-update"))
      .toBe(true);

    leftEngine.stop();
    rightEngine.stop();
  });

  it("converges to zero active Projects after different empty Projects are archived offline", () => {
    const base = NoteProject.create();
    const notes = base.listProjects()[0]!;
    const other = base.createProject("Other");
    const left = cloneProject(base);
    const right = cloneProject(base);
    left.archiveProject(notes.id);
    right.archiveProject(other.id);

    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport);
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport);
    leftEngine.start();
    rightEngine.start();

    expect(left.listProjects()).toEqual(right.listProjects());
    expect(
      left.listProjects().filter((project) => project.status === "active"),
    ).toEqual([]);

    leftEngine.stop();
    rightEngine.stop();
  });

  it("reactivates a Project after concurrent archive and Note creation synchronize", () => {
    const base = NoteProject.create();
    const projectId = base.listProjects()[0]!.id;
    const archiver = cloneProject(base);
    const creator = cloneProject(base);
    archiver.archiveProject(projectId);
    const note = creator.createDocument("Concurrent note", projectId);

    const [archiverTransport, creatorTransport] = createTransportPair();
    const archiverEngine = new WorkspaceSyncEngine(archiver, archiverTransport);
    const creatorEngine = new WorkspaceSyncEngine(creator, creatorTransport);
    archiverEngine.start();
    creatorEngine.start();

    for (const workspace of [archiver, creator]) {
      expect(workspace.getProject(projectId)?.status).toBe("active");
      expect(workspace.getDocumentProjectId(note.id)).toBe(projectId);
      expect(workspace.getDocument(note.id)?.title).toBe("Concurrent note");
    }

    archiverEngine.stop();
    creatorEngine.stop();
  });

  it("reactivates a Project after concurrent archive and Note move synchronize", () => {
    const base = NoteProject.create();
    const destination = base.createProject("Destination");
    const note = base.createDocument(
      "Concurrent move",
      base.listProjects()[0]!.id,
    );
    const archiver = cloneProject(base);
    const mover = cloneProject(base);
    archiver.archiveProject(destination.id);
    mover.moveDocument(note.id, destination.id);

    const [archiverTransport, moverTransport] = createTransportPair();
    const archiverEngine = new WorkspaceSyncEngine(archiver, archiverTransport);
    const moverEngine = new WorkspaceSyncEngine(mover, moverTransport);
    archiverEngine.start();
    moverEngine.start();

    for (const workspace of [archiver, mover]) {
      expect(workspace.getProject(destination.id)?.status).toBe("active");
      expect(workspace.getDocumentProjectId(note.id)).toBe(destination.id);
      expect(workspace.getDocument(note.id)?.title).toBe("Concurrent move");
    }

    archiverEngine.stop();
    moverEngine.stop();
  });

  it("synchronizes Project reactivation when a trashed Note is restored", () => {
    const base = NoteProject.create();
    const projectId = base.listProjects()[0]!.id;
    const note = base.createDocument("Restore me", projectId);
    base.deleteDocument(note.id);
    base.archiveProject(projectId);
    const left = cloneProject(base);
    const right = cloneProject(base);
    const [leftTransport, rightTransport] = createTransportPair();
    const leftEngine = new WorkspaceSyncEngine(left, leftTransport);
    const rightEngine = new WorkspaceSyncEngine(right, rightTransport);
    leftEngine.start();
    rightEngine.start();

    left.restoreDocument(note.id);

    for (const workspace of [left, right]) {
      expect(workspace.getProject(projectId)?.status).toBe("active");
      expect(workspace.getDocumentProjectId(note.id)).toBe(projectId);
      expect(workspace.getDocument(note.id)?.title).toBe("Restore me");
    }

    leftEngine.stop();
    rightEngine.stop();
  });

  it("reports initial remote full-state completion after applying the remote state", () => {
    const source = NoteProject.create();
    source.createDocument("Bootstrap note");
    const joined = NoteProject.empty(source.id);
    const [sourceTransport, joinedTransport] = createTransportPair();
    let completionCount = 0;

    const sourceEngine = new WorkspaceSyncEngine(source, sourceTransport);
    const joinedEngine = new WorkspaceSyncEngine(joined, joinedTransport, {
      onInitialRemoteStateReceived: () => {
        completionCount += 1;
      },
    });

    sourceEngine.start();
    joinedEngine.start();

    expect(completionCount).toBe(1);
    expect(joined.listDocuments().map(({ title }) => title)).toContain(
      "Bootstrap note",
    );
    expect(joined.listProjects()).toEqual(source.listProjects());
    expect(
      joined.listProjects().filter((project) => project.name === "Notes"),
    ).toHaveLength(1);

    sourceEngine.stop();
    joinedEngine.stop();
  });

  it("does not complete initial remote state after a receive failure", () => {
    const joined = NoteProject.create();
    vi.spyOn(joined, "importManifestUpdate").mockImplementation(() => {
      throw new Error("Invalid manifest update");
    });

    const [senderTransport, joinedTransport] = createTransportPair();
    let completionCount = 0;
    let errorCount = 0;

    const joinedEngine = new WorkspaceSyncEngine(joined, joinedTransport, {
      onInitialRemoteStateReceived: () => {
        completionCount += 1;
      },
      onInitialSyncError: () => {
        errorCount += 1;
      },
    });

    joinedEngine.start();

    senderTransport.send(
      encodeSyncMessage({
        type: "manifest-update",
        update: Uint8Array.of(1),
      }),
    );
    senderTransport.send(encodeSyncMessage({ type: "full-state-end" }));
    senderTransport.send(encodeSyncMessage({ type: "full-state-end" }));

    expect(errorCount).toBe(1);
    expect(completionCount).toBe(0);

    joinedEngine.stop();
  });

});
