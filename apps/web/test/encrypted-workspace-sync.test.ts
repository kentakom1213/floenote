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
