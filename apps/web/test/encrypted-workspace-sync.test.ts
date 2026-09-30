import {
  decryptWorkspaceSyncPayload,
  encryptWorkspaceSyncPayload,
  generateWorkspaceKey,
} from "@floe-note/crypto";
import { NoteProject } from "@floe-note/document";
import type { WorkspaceId } from "@floe-note/domain";
import {
  EncryptedSyncTransport,
  WorkspaceSyncEngine,
} from "@floe-note/sync";
import type { Transport } from "@floe-note/transport";
import { BroadcastChannelTransport } from "@floe-note/transport/broadcast-channel";
import { describe, expect, it, vi } from "vitest";

class MemoryTransport implements Transport {
  peer: MemoryTransport | null = null;
  readonly handlers = new Set<(data: Uint8Array) => void>();

  send(data: Uint8Array): void {
    for (const handler of this.peer?.handlers ?? []) handler(data.slice());
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.handlers.clear();
  }
}

function transportPair(): [MemoryTransport, MemoryTransport] {
  const left = new MemoryTransport();
  const right = new MemoryTransport();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

function encryptedTransport(
  transport: Transport,
  workspaceId: WorkspaceId,
  key: Uint8Array,
  onError?: (error: Error) => void,
): EncryptedSyncTransport {
  return new EncryptedSyncTransport(
    transport,
    {
      encrypt: (plaintext) =>
        encryptWorkspaceSyncPayload(workspaceId, 1, key, plaintext),
      decrypt: (envelope) =>
        decryptWorkspaceSyncPayload(workspaceId, key, envelope),
    },
    { onError },
  );
}

describe("encrypted Workspace synchronization", () => {
  it("relays encrypted updates in both directions between a peer and local tab", async () => {
    const key = await generateWorkspaceKey();
    const remote = NoteProject.create();
    const documentId = remote.createDocument("Initial note").id;
    const owner = NoteProject.empty(remote.id);
    const follower = NoteProject.empty(remote.id);
    const [remoteRaw, ownerRemoteRaw] = transportPair();
    const ownerLocalRaw = new BroadcastChannelTransport(remote.id);
    const followerRaw = new BroadcastChannelTransport(remote.id);
    const engines = [
      new WorkspaceSyncEngine(
        remote,
        encryptedTransport(remoteRaw, remote.id, key),
      ),
      new WorkspaceSyncEngine(
        owner,
        encryptedTransport(ownerRemoteRaw, owner.id, key),
        { relayScope: "remote-peer" },
      ),
      new WorkspaceSyncEngine(
        owner,
        encryptedTransport(ownerLocalRaw, owner.id, key),
        { relayScope: "local-tab" },
      ),
      new WorkspaceSyncEngine(
        follower,
        encryptedTransport(followerRaw, follower.id, key),
        { relayScope: "local-tab" },
      ),
    ];

    try {
      for (const engine of engines) engine.start();
      await vi.waitFor(() => {
        expect(follower.getDocument(documentId)?.title).toBe("Initial note");
      });

      remote.getDocument(documentId)?.setTitle("Remote edit");
      await vi.waitFor(() => {
        expect(follower.getDocument(documentId)?.title).toBe("Remote edit");
      });

      follower.getDocument(documentId)?.setTitle("Other tab edit");
      await vi.waitFor(() => {
        expect(remote.getDocument(documentId)?.title).toBe("Other tab edit");
      });

      // The former follower takes over remote sync without reopening either tab.
      engines[0]?.stop();
      engines[1]?.stop();
      const [newRemoteRaw, newOwnerRemoteRaw] = transportPair();
      const newRemoteEngine = new WorkspaceSyncEngine(
        remote,
        encryptedTransport(newRemoteRaw, remote.id, key),
      );
      const newOwnerRemoteEngine = new WorkspaceSyncEngine(
        follower,
        encryptedTransport(newOwnerRemoteRaw, follower.id, key),
        { relayScope: "remote-peer" },
      );
      engines.push(newRemoteEngine, newOwnerRemoteEngine);
      newRemoteEngine.start();
      newOwnerRemoteEngine.start();

      remote.getDocument(documentId)?.setTitle("After handoff");
      await vi.waitFor(() => {
        expect(owner.getDocument(documentId)?.title).toBe("After handoff");
      });

      owner.getDocument(documentId)?.setTitle("Former owner edit");
      await vi.waitFor(() => {
        expect(remote.getDocument(documentId)?.title).toBe("Former owner edit");
      });
    } finally {
      for (const engine of engines) engine.stop();
      key.fill(0);
    }
  });

  it("synchronizes manifest and note Loro updates within one Workspace", async () => {
    const key = await generateWorkspaceKey();
    const source = NoteProject.create();
    const target = NoteProject.create(source.id);
    const [leftRaw, rightRaw] = transportPair();
    const sourceEngine = new WorkspaceSyncEngine(
      source,
      encryptedTransport(leftRaw, source.id, key),
    );
    const targetEngine = new WorkspaceSyncEngine(
      target,
      encryptedTransport(rightRaw, target.id, key),
    );

    try {
      sourceEngine.start();
      targetEngine.start();
      const document = source.createDocumentWithInitialState({
        title: "Encrypted note",
        body: "Workspace-scoped content",
        createdAt: 1,
        updatedAt: 1,
        tags: [],
      });

      await vi.waitFor(() => {
        expect(target.getDocument(document.id)?.bodyText).toBe(
          "Workspace-scoped content",
        );
      });
    } finally {
      sourceEngine.stop();
      targetEngine.stop();
      key.fill(0);
    }
  });

  it("rejects an encrypted update from another Workspace", async () => {
    const key = await generateWorkspaceKey();
    const source = NoteProject.create();
    source.createDocument("Must stay isolated");
    const target = NoteProject.create();
    const errors: Error[] = [];
    const [leftRaw, rightRaw] = transportPair();
    const sourceEngine = new WorkspaceSyncEngine(
      source,
      encryptedTransport(leftRaw, source.id, key),
    );
    const targetEngine = new WorkspaceSyncEngine(
      target,
      encryptedTransport(rightRaw, target.id, key, (error) =>
        errors.push(error),
      ),
    );

    try {
      sourceEngine.start();
      targetEngine.start();
      await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
      expect(errors[0]?.message).toContain(
        "Could not authenticate encrypted Workspace sync payload",
      );
      expect(target.listDocuments()).toEqual([]);
    } finally {
      sourceEngine.stop();
      targetEngine.stop();
      key.fill(0);
    }
  });
});
