import "fake-indexeddb/auto";

import { NoteProject } from "@floe-note/document";
import { createDeviceId } from "@floe-note/domain";
import { describe, expect, it } from "vitest";

import { DexieWorkspaceStorage } from "../src/dexie-workspace-storage.js";
import type {
  WorkspaceStorageCrypto,
  WorkspaceStorageRecordContext,
} from "../src/workspace-storage.js";

const crypto: WorkspaceStorageCrypto = {
  async encryptWorkspaceStoragePayload(
    _workspaceId,
    _keyEpoch,
    _context,
    plaintext,
  ) {
    return plaintext.slice();
  },
  async decryptWorkspaceStoragePayload(_workspaceId, _context, envelope) {
    return { keyEpoch: 1, plaintext: envelope.slice() };
  },
};

describe("Project-aware Workspace persistence", () => {
  it("reloads multiple Projects, lifecycle state, and Note membership", async () => {
    const storage = new DexieWorkspaceStorage();
    const { project: workspace } = await storage.createWorkspace("Personal");
    const stopWatching = storage.watchWorkspace(workspace, crypto, 1);
    const notes = workspace.listProjects()[0]!;
    const research = workspace.createProject("Research");
    const archived = workspace.createProject("Unused");
    const firstNote = workspace.createDocument("First", notes.id);
    const secondNote = workspace.createDocument("Second", research.id);
    workspace.moveDocument(firstNote.id, research.id);
    workspace.renameWorkspaceProject(research.id, "Renamed research");
    workspace.archiveProject(archived.id);
    await storage.flushPendingWrites();
    stopWatching();

    const reopenedStorage = new DexieWorkspaceStorage();
    const reopened = (await reopenedStorage.openWorkspace(workspace.id, crypto)).project;
    expect(reopened.listProjects()).toEqual(workspace.listProjects());
    expect(reopened.getDocumentProjectId(firstNote.id)).toBe(research.id);
    expect(reopened.getDocumentProjectId(secondNote.id)).toBe(research.id);
    expect(reopened.getDocument(firstNote.id)?.title).toBe("First");
    expect(reopened.getProject(archived.id)?.status).toBe("archived");

    const stopReopenedWatching = reopenedStorage.watchWorkspace(reopened, crypto, 1);
    reopened.reopenProject(archived.id);
    await reopenedStorage.flushPendingWrites();
    stopReopenedWatching();

    const reopenedAgain = (
      await new DexieWorkspaceStorage().openWorkspace(workspace.id, crypto)
    ).project;
    expect(reopenedAgain.getProject(archived.id)?.status).toBe("active");
    expect(reopenedAgain.getDocumentProjectId(firstNote.id)).toBe(research.id);
  });

  it("reloads a Workspace with zero active Projects", async () => {
    const storage = new DexieWorkspaceStorage();
    const { project: workspace } = await storage.createWorkspace("Empty");
    const only = workspace.listProjects()[0]!;
    const stopWatching = storage.watchWorkspace(workspace, crypto, 1);
    workspace.archiveProject(only.id);
    await storage.flushPendingWrites();
    stopWatching();

    const reopened = (
      await new DexieWorkspaceStorage().openWorkspace(workspace.id, crypto)
    ).project;
    expect(reopened.listProjects()).toEqual([{ ...only, status: "archived" }]);
    expect(
      reopened.listProjects().filter((project) => project.status === "active"),
    ).toEqual([]);
  });

  it("encrypts and reloads local document replication observations", async () => {
    const storage = new DexieWorkspaceStorage();
    const { project: workspace } = await storage.createWorkspace("Replication");
    const note = workspace.createDocument("Observed");
    const deviceId = createDeviceId();
    const frontiers = note.captureHistoryFrontiers();
    const contexts: WorkspaceStorageRecordContext[] = [];
    const observationCrypto: WorkspaceStorageCrypto = {
      async encryptWorkspaceStoragePayload(
        _workspaceId,
        _keyEpoch,
        context,
        plaintext,
      ) {
        contexts.push(context);
        return Uint8Array.from(plaintext, (byte) => byte ^ 0xff);
      },
      async decryptWorkspaceStoragePayload(
        _workspaceId,
        context,
        envelope,
      ) {
        contexts.push(context);
        return {
          keyEpoch: 1,
          plaintext: Uint8Array.from(envelope, (byte) => byte ^ 0xff),
        };
      },
    };

    await storage.saveDocumentReplicationObservation(
      {
        workspaceId: workspace.id,
        deviceId,
        documentId: note.id,
        frontiers,
        confirmedAt: 1234,
      },
      observationCrypto,
      1,
    );

    const rawRecord = await readReplicationObservationRecord(
      workspace.id,
      deviceId,
      note.id,
    );
    expect(rawRecord).not.toHaveProperty("frontiers");
    expect(rawRecord).not.toHaveProperty("confirmedAt");
    expect(rawRecord.encryptedPayload).toBeInstanceOf(Uint8Array);

    const observations =
      await new DexieWorkspaceStorage().listDocumentReplicationObservations(
        workspace.id,
        note.id,
        observationCrypto,
      );

    expect(observations).toEqual([
      {
        workspaceId: workspace.id,
        deviceId,
        documentId: note.id,
        frontiers,
        confirmedAt: 1234,
      },
    ]);
    expect(contexts).toEqual([
      {
        kind: "replication-observation",
        deviceId,
        documentId: note.id,
      },
      {
        kind: "replication-observation",
        deviceId,
        documentId: note.id,
      },
    ]);
  });

  it("persists joined manifest state without creating another Notes Project", async () => {
    const source = NoteProject.create();
    const research = source.createProject("Research");
    const note = source.createDocument("Joined note", research.id);
    const storage = new DexieWorkspaceStorage();
    const joined = await storage.initializeJoinedWorkspace(source.id, crypto, 1);
    expect(joined.listProjects()).toEqual([]);

    const stopWatching = storage.watchWorkspace(joined, crypto, 1);
    joined.importManifestUpdate(source.exportManifestUpdate());
    joined.importDocumentUpdate(note.id, note.exportUpdate());
    await storage.flushPendingWrites();
    await storage.completeJoinedWorkspaceBootstrap(source.id);
    stopWatching();

    const reopened = (
      await new DexieWorkspaceStorage().openWorkspace(source.id, crypto)
    ).project;
    expect(reopened.listProjects()).toEqual(source.listProjects());
    expect(
      reopened.listProjects().filter((project) => project.name === "Notes"),
    ).toHaveLength(1);
    expect(reopened.getDocumentProjectId(note.id)).toBe(research.id);
    expect(reopened.getDocument(note.id)?.title).toBe("Joined note");
  });
});


async function readReplicationObservationRecord(
  workspaceId: string,
  deviceId: string,
  documentId: string,
): Promise<Record<string, unknown>> {
  const request = indexedDB.open("floe-note-workspaces");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  try {
    const get = database
      .transaction("replicationObservations")
      .objectStore("replicationObservations")
      .get([workspaceId, deviceId, documentId]);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result as Record<string, unknown>);
    });
  } finally {
    database.close();
  }
}
