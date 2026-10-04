import "fake-indexeddb/auto";

import {
  decryptWorkspaceStoragePayload,
  encryptWorkspaceStoragePayload,
  generateWorkspaceKey,
  readWorkspaceStoragePayloadKeyEpoch,
} from "@floe-note/crypto";
import { NoteProject } from "@floe-note/document";
import { createDeviceId, type WorkspaceId } from "@floe-note/domain";
import {
  DexieWorkspaceStorage,
  type WorkspaceStorageCrypto,
} from "@floe-note/storage";
import {
  EncryptedSyncTransport,
  WorkspaceSyncEngine,
} from "@floe-note/sync";
import type { Transport } from "@floe-note/transport";
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
): EncryptedSyncTransport {
  return new EncryptedSyncTransport(transport, {
    encrypt: (plaintext) =>
      encryptWorkspaceSyncPayload(workspaceId, 1, key, plaintext),
    decrypt: (envelope) =>
      decryptWorkspaceSyncPayload(workspaceId, key, envelope),
  });
}

function workspaceStorageCrypto(key: Uint8Array): WorkspaceStorageCrypto {
  return {
    encryptWorkspaceStoragePayload(
      workspaceId,
      keyEpoch,
      context,
      plaintext,
    ) {
      return encryptWorkspaceStoragePayload(
        workspaceId,
        keyEpoch,
        context,
        key,
        plaintext,
      );
    },
    async decryptWorkspaceStoragePayload(
      workspaceId,
      context,
      envelope,
    ) {
      const keyEpoch = readWorkspaceStoragePayloadKeyEpoch(envelope);
      return {
        keyEpoch,
        plaintext: await decryptWorkspaceStoragePayload(
          workspaceId,
          keyEpoch,
          context,
          key,
          envelope,
        ),
      };
    },
  };
}

describe("invitation replication confirmation", () => {
  it("persists the joining device's initial document acknowledgement", async () => {
    const key = await generateWorkspaceKey();
    const host = NoteProject.create();
    const document = host.createDocument("Invitation bootstrap");
    const joined = NoteProject.empty(host.id);
    const joiningDeviceId = createDeviceId();
    const storage = new DexieWorkspaceStorage();
    const crypto = workspaceStorageCrypto(key);
    const [hostRaw, joinedRaw] = transportPair();

    const hostEngine = new WorkspaceSyncEngine(
      host,
      encryptedTransport(hostRaw, host.id, key),
      {
        onRemoteDocumentVersionConfirmed: (documentId, frontiers) => {
          void storage.saveDocumentReplicationObservation(
            {
              workspaceId: host.id,
              deviceId: joiningDeviceId,
              documentId,
              frontiers,
              confirmedAt: 1234,
            },
            crypto,
            1,
          );
        },
      },
    );
    const joinedEngine = new WorkspaceSyncEngine(
      joined,
      encryptedTransport(joinedRaw, joined.id, key),
      {
        // Invitation join uses the existing confirmation hook to opt into
        // sending acknowledgements; it does not persist host observations.
        onRemoteDocumentVersionConfirmed: () => {},
      },
    );

    try {
      hostEngine.start();
      joinedEngine.start();

      await vi.waitFor(async () => {
        const observations =
          await storage.listDocumentReplicationObservations(
            host.id,
            document.id,
            crypto,
          );

        expect(observations).toHaveLength(1);
        expect(observations[0]?.deviceId).toBe(joiningDeviceId);
        expect(observations[0]?.confirmedAt).toBe(1234);
        expect(
          host
            .getDocument(document.id)
            ?.matchesHistoryFrontiers(observations[0]!.frontiers),
        ).toBe(true);
      });
    } finally {
      hostEngine.stop();
      joinedEngine.stop();
      await storage.eraseAllLocalData();
      key.fill(0);
    }
  });
});
