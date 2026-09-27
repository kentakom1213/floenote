import { NoteDocument, NoteProject } from "@floe-note/document";
import {
  parseDocumentId,
  parseWorkspaceId,
  type DocumentId,
  type WorkspaceId,
} from "@floe-note/domain";
import {
  parseSecurityStateWirePayload,
  securityStateToWire,
  type SecurityState,
  type SecurityStateWirePayload,
} from "@floe-note/security";
import Dexie, { type Table } from "dexie";

import {
  filterLoadableDocumentRows,
  reconcileDocumentSubscriptions,
  shouldPersistDocumentReference,
  staleDocumentRowIds,
} from "./document-persistence-reconciliation.js";
import type {
  OpenWorkspaceResult,
  WorkspaceStorage,
  WorkspaceStorageCrypto,
  WorkspaceStorageRecordContext,
  StoredWorkspaceSummary,
} from "./workspace-storage.js";

// Pre-Workspace development data remains in "floe-note" and is never opened.
// Device Vault uses its own database and is unaffected by this boundary.
const DATABASE_NAME = "floe-note-workspaces";
const LOCAL_WORKSPACE_SLOT = "default";
const DETACHED_WORKSPACE_SLOT_PREFIX = "detached:";
const BOOTSTRAPPING_WORKSPACE_SLOT_PREFIX = "bootstrapping:";

type WorkspaceRecord = {
  workspaceId: string;
  localSlot: string;
  createdAt: number;
  bootstrapState?: "bootstrapping" | "ready";
};

type ManifestRecord = {
  workspaceId: string;
  encryptedSnapshot: Uint8Array;
};

type DocumentRecord = {
  workspaceId: string;
  documentId: string;
  encryptedSnapshot: Uint8Array;
};

class FloeNoteDatabase extends Dexie {
  workspaces!: Table<WorkspaceRecord, string>;
  manifests!: Table<ManifestRecord, string>;
  documents!: Table<DocumentRecord, [string, string]>;
  security!: Table<SecurityStateWirePayload, string>;

  constructor() {
    super(DATABASE_NAME);

    this.version(1).stores({
      workspaces: "&workspaceId,&localSlot,createdAt",
      manifests: "&workspaceId",
      documents: "[workspaceId+documentId],workspaceId,documentId",
      security: "&workspaceId",
    });
  }
}

export class DexieWorkspaceStorage implements WorkspaceStorage {
  readonly #db = new FloeNoteDatabase();
  #writeQueue: Promise<void> = Promise.resolve();
  #writeFailure: Error | null = null;

  openLastWorkspace(
    crypto: WorkspaceStorageCrypto,
  ): Promise<OpenWorkspaceResult | null> {
    return this.#loadLastWorkspace(crypto);
  }

  async listWorkspaces(
    crypto: WorkspaceStorageCrypto,
  ): Promise<readonly StoredWorkspaceSummary[]> {
    const records = await this.#db.workspaces.orderBy("createdAt").toArray();

    return Promise.all(
      records
        .filter((record) => record.bootstrapState !== "bootstrapping")
        .map(async (record) => ({
          id: parseWorkspaceId(record.workspaceId),
          name: await this.#loadWorkspaceName(
            parseWorkspaceId(record.workspaceId),
            crypto,
          ),
          createdAt: record.createdAt,
          isActive: record.localSlot === LOCAL_WORKSPACE_SLOT,
        })),
    );
  }

  async openWorkspace(
    workspaceId: WorkspaceId,
    crypto: WorkspaceStorageCrypto,
  ): Promise<OpenWorkspaceResult> {
    const record = await this.#db.workspaces.get(workspaceId);
    if (!record) {
      throw new Error("Workspace is not available on this device");
    }
    if (record.bootstrapState === "bootstrapping") {
      throw new Error("Workspace setup is incomplete on this device");
    }

    const project = await this.#loadWorkspace(workspaceId, crypto);
    await this.#activateWorkspace(workspaceId);
    return { project, isNew: false };
  }

  async createWorkspace(name: string): Promise<OpenWorkspaceResult> {
    const project = NoteProject.create();
    project.renameProject(name);

    await this.#db.transaction("rw", this.#db.workspaces, async () => {
      const current = await this.#db.workspaces
        .where("localSlot")
        .equals(LOCAL_WORKSPACE_SLOT)
        .first();

      if (current) {
        await this.#db.workspaces.update(current.workspaceId, {
          localSlot: `${DETACHED_WORKSPACE_SLOT_PREFIX}${current.workspaceId}`,
        });
      }

      await this.#db.workspaces.add({
        workspaceId: project.id,
        localSlot: LOCAL_WORKSPACE_SLOT,
        createdAt: Date.now(),
      });
    });

    return { project, isNew: true };
  }

  async initializeCommittedWorkspace(
    project: NoteProject,
    state: SecurityState,
    crypto: WorkspaceStorageCrypto,
  ): Promise<OpenWorkspaceResult> {
    if (state.workspaceId !== project.id) {
      throw new Error("Committed SecurityState does not match Workspace");
    }

    await this.#writeQueue;

    const documentRows = await Promise.all(
      project.getAllDocuments().map(async (document) => ({
        workspaceId: project.id,
        documentId: document.id,
        encryptedSnapshot: await crypto.encryptWorkspaceStoragePayload(
          project.id,
          state.keyEpoch,
          documentContext(document.id),
          document.exportSnapshot(),
        ),
      })),
    );
    const encryptedManifest = await crypto.encryptWorkspaceStoragePayload(
      project.id,
      state.keyEpoch,
      manifestContext(),
      project.exportManifestSnapshot(),
    );

    await this.#db.transaction(
      "rw",
      this.#db.workspaces,
      this.#db.manifests,
      this.#db.documents,
      this.#db.security,
      async () => {
        const existing = await this.#db.workspaces.get(project.id);
        if (existing) {
          throw new Error("Workspace already exists on this device");
        }

        const current = await this.#db.workspaces
          .where("localSlot")
          .equals(LOCAL_WORKSPACE_SLOT)
          .first();

        if (current) {
          await this.#db.workspaces.update(current.workspaceId, {
            localSlot: `${DETACHED_WORKSPACE_SLOT_PREFIX}${current.workspaceId}`,
          });
        }

        await this.#db.workspaces.add({
          workspaceId: project.id,
          localSlot: LOCAL_WORKSPACE_SLOT,
          createdAt: Date.now(),
        });
        await this.#db.manifests.add({
          workspaceId: project.id,
          encryptedSnapshot: encryptedManifest,
        });
        for (const row of documentRows) {
          await this.#db.documents.add(row);
        }
        await this.#db.security.add(securityStateToWire(state));
      },
    );

    return { project, isNew: false };
  }

  async removeWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceId | null> {
    await this.#writeQueue;

    const record = await this.#db.workspaces.get(workspaceId);
    if (!record) return null;

    let nextWorkspaceId: WorkspaceId | null = null;

    await this.#db.transaction(
      "rw",
      this.#db.workspaces,
      this.#db.manifests,
      this.#db.documents,
      this.#db.security,
      async () => {
        const remaining = await this.#db.workspaces
          .orderBy("createdAt")
          .filter((candidate) => candidate.workspaceId !== workspaceId)
          .toArray();

        await this.#db.documents
          .where("workspaceId")
          .equals(workspaceId)
          .delete();
        await this.#db.manifests.delete(workspaceId);
        await this.#db.security.delete(workspaceId);
        await this.#db.workspaces.delete(workspaceId);

        if (record.localSlot === LOCAL_WORKSPACE_SLOT && remaining[0]) {
          await this.#db.workspaces.update(remaining[0].workspaceId, {
            localSlot: LOCAL_WORKSPACE_SLOT,
          });
          nextWorkspaceId = parseWorkspaceId(remaining[0].workspaceId);
        }
      },
    );

    return nextWorkspaceId;
  }

  async eraseAllLocalData(): Promise<void> {
    await this.#writeQueue;
    this.#db.close();
    await Dexie.delete(DATABASE_NAME);
  }

  async initializeJoinedWorkspace(
    workspaceId: WorkspaceId,
    crypto?: WorkspaceStorageCrypto,
    keyEpoch?: number,
  ): Promise<NoteProject> {
    if (!crypto || keyEpoch === undefined) {
      throw new Error(
        "Device Vault and current WorkspaceKey are required to persist a joined Workspace",
      );
    }

    await this.#writeQueue;
    this.#writeFailure = null;

    const target = await this.#db.workspaces.get(workspaceId);
    if (target && target.bootstrapState !== "bootstrapping") {
      return this.#loadWorkspace(workspaceId, crypto);
    }

    const emptyProject = NoteProject.create(workspaceId);
    const emptyEncryptedManifest =
      await crypto.encryptWorkspaceStoragePayload(
        workspaceId,
        keyEpoch,
        manifestContext(),
        emptyProject.exportManifestSnapshot(),
      );

    await this.#db.transaction(
      "rw",
      this.#db.workspaces,
      this.#db.manifests,
      this.#db.documents,
      async () => {
        const existing = await this.#db.workspaces.get(workspaceId);
        if (existing && existing.bootstrapState !== "bootstrapping") {
          return;
        }

        await this.#db.documents
          .where("workspaceId")
          .equals(workspaceId)
          .delete();
        await this.#db.workspaces.put({
          workspaceId,
          localSlot: `${BOOTSTRAPPING_WORKSPACE_SLOT_PREFIX}${workspaceId}`,
          createdAt: existing?.createdAt ?? Date.now(),
          bootstrapState: "bootstrapping",
        });
        await this.#db.manifests.put({
          workspaceId,
          encryptedSnapshot: emptyEncryptedManifest,
        });
      },
    );

    return emptyProject;
  }

  async completeJoinedWorkspaceBootstrap(
    workspaceId: WorkspaceId,
  ): Promise<void> {
    await this.#writeQueue;

    await this.#db.transaction("rw", this.#db.workspaces, async () => {
      const target = await this.#db.workspaces.get(workspaceId);
      if (!target) {
        throw new Error("Joined Workspace is not available on this device");
      }

      const current = await this.#db.workspaces
        .where("localSlot")
        .equals(LOCAL_WORKSPACE_SLOT)
        .first();

      if (current && current.workspaceId !== workspaceId) {
        await this.#db.workspaces.update(current.workspaceId, {
          localSlot: `${DETACHED_WORKSPACE_SLOT_PREFIX}${current.workspaceId}`,
        });
      }

      await this.#db.workspaces.update(workspaceId, {
        localSlot: LOCAL_WORKSPACE_SLOT,
        bootstrapState: "ready",
      });
    });
  }

  async flushPendingWrites(): Promise<void> {
    await this.#writeQueue;

    const failure = this.#writeFailure;
    this.#writeFailure = null;
    if (failure) throw failure;
  }

  async loadSecurityState(
    workspaceId: WorkspaceId,
  ): Promise<SecurityState | null> {
    const record = await this.#db.security.get(workspaceId);
    return record ? parseSecurityStateWirePayload(record, workspaceId) : null;
  }

  async saveCommittedSecurityState(state: SecurityState): Promise<void> {
    await this.#db.security.put(securityStateToWire(state));
  }

  watchWorkspace(
    project: NoteProject,
    crypto?: WorkspaceStorageCrypto,
    keyEpoch?: number,
  ): () => void {
    if (!crypto || keyEpoch === undefined) {
      throw new Error(
        "Device Vault and current WorkspaceKey are required to persist Workspace data",
      );
    }

    const documentSubscriptions = new Map<string, () => void>();

    const attachDocument = (document: NoteDocument) => {
      if (documentSubscriptions.has(document.id)) return;

      const unsubscribe = document.subscribe(() => {
        this.#enqueue(async () => {
          if (!shouldPersistDocumentReference(project, document)) return;

          await this.#saveDocument(
            project.id,
            document,
            crypto,
            keyEpoch,
          );
        });
      });
      documentSubscriptions.set(document.id, unsubscribe);
    };

    const reconcileDocuments = () => {
      reconcileDocumentSubscriptions(
        project.getAllDocuments(),
        documentSubscriptions,
        attachDocument,
      );
    };

    reconcileDocuments();

    const unsubscribeProject = project.subscribe(() => {
      reconcileDocuments();

      this.#enqueue(() =>
        this.#saveWorkspaceState(project, crypto, keyEpoch),
      );
    });

    // Persist immediately so snapshots use the active key epoch even if the
    // user makes no edit.
    this.#enqueue(() =>
      this.#saveWorkspaceState(project, crypto, keyEpoch),
    );

    return () => {
      unsubscribeProject();
      for (const unsubscribe of documentSubscriptions.values()) {
        unsubscribe();
      }
    };
  }

  async #loadLastWorkspace(
    crypto: WorkspaceStorageCrypto,
  ): Promise<OpenWorkspaceResult | null> {
    const existing = await this.#db.workspaces
      .where("localSlot")
      .equals(LOCAL_WORKSPACE_SLOT)
      .first();

    if (!existing) return null;

    return {
      project: await this.#loadWorkspace(
        parseWorkspaceId(existing.workspaceId),
        crypto,
      ),
      isNew: false,
    };
  }

  async #activateWorkspace(workspaceId: WorkspaceId): Promise<void> {
    await this.#db.transaction("rw", this.#db.workspaces, async () => {
      const current = await this.#db.workspaces
        .where("localSlot")
        .equals(LOCAL_WORKSPACE_SLOT)
        .first();

      if (current && current.workspaceId !== workspaceId) {
        await this.#db.workspaces.update(current.workspaceId, {
          localSlot: `${DETACHED_WORKSPACE_SLOT_PREFIX}${current.workspaceId}`,
        });
      }

      await this.#db.workspaces.update(workspaceId, {
        localSlot: LOCAL_WORKSPACE_SLOT,
      });
    });
  }

  async #loadWorkspaceName(
    workspaceId: WorkspaceId,
    crypto: WorkspaceStorageCrypto,
  ): Promise<string> {
    const manifest = await this.#db.manifests.get(workspaceId);
    if (!manifest) {
      return NoteProject.create(workspaceId).name;
    }

    const manifestSnapshot = await this.#readSnapshot(
      workspaceId,
      manifestContext(),
      manifest,
      crypto,
    );

    return NoteProject.fromSnapshot(workspaceId, manifestSnapshot, []).name;
  }

  async #loadWorkspace(
    workspaceId: WorkspaceId,
    crypto: WorkspaceStorageCrypto,
  ): Promise<NoteProject> {
    const manifest = await this.#db.manifests.get(workspaceId);
    if (!manifest) {
      return NoteProject.create(workspaceId);
    }

    const manifestSnapshot = await this.#readSnapshot(
      workspaceId,
      manifestContext(),
      manifest,
      crypto,
    );

    const manifestProject = NoteProject.fromSnapshot(
      workspaceId,
      manifestSnapshot,
      [],
    );
    const documentRows = await this.#db.documents
      .where("workspaceId")
      .equals(workspaceId)
      .toArray();

    const documents = await Promise.all(
      filterLoadableDocumentRows(manifestProject, documentRows).map(
        async (record) => {
          const documentId = parseDocumentId(record.documentId);
          const snapshot = await this.#readSnapshot(
            workspaceId,
            documentContext(documentId),
            record,
            crypto,
          );
          return NoteDocument.fromSnapshot(documentId, snapshot);
        },
      ),
    );

    return NoteProject.fromSnapshot(
      workspaceId,
      manifestSnapshot,
      documents,
    );
  }

  async #readSnapshot(
    workspaceId: WorkspaceId,
    context: WorkspaceStorageRecordContext,
    record: { encryptedSnapshot: Uint8Array },
    crypto: WorkspaceStorageCrypto,
  ): Promise<Uint8Array> {
    if (!record.encryptedSnapshot) {
      throw new Error("Encrypted Workspace snapshot is missing");
    }
    const decrypted = await crypto.decryptWorkspaceStoragePayload(
      workspaceId,
      context,
      record.encryptedSnapshot,
    );
    return decrypted.plaintext;
  }

  #enqueue(write: () => Promise<void>): void {
    this.#writeQueue = this.#writeQueue.then(async () => {
      try {
        await write();
      } catch (error: unknown) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.#writeFailure ??= failure;
        console.error("Failed to persist Floe Note state", failure);
      }
    });
  }

  async #saveWorkspaceState(
    project: NoteProject,
    crypto: WorkspaceStorageCrypto,
    keyEpoch: number,
  ): Promise<void> {
    const documentRows = await Promise.all(
      project.getAllDocuments().map(async (document) => ({
        workspaceId: project.id,
        documentId: document.id,
        encryptedSnapshot: await crypto.encryptWorkspaceStoragePayload(
          project.id,
          keyEpoch,
          documentContext(document.id),
          document.exportSnapshot(),
        ),
      })),
    );

    const encryptedManifest =
      await crypto.encryptWorkspaceStoragePayload(
        project.id,
        keyEpoch,
        manifestContext(),
        project.exportManifestSnapshot(),
      );

    await this.#db.transaction(
      "rw",
      this.#db.manifests,
      this.#db.documents,
      async () => {
        const existingRows = await this.#db.documents
          .where("workspaceId")
          .equals(project.id)
          .toArray();

        for (const documentId of staleDocumentRowIds(
          project.getAllDocuments(),
          existingRows,
        )) {
          await this.#db.documents.delete([
            project.id,
            documentId,
          ]);
        }

        for (const row of documentRows) {
          await this.#db.documents.put(row);
        }

        await this.#db.manifests.put({
          workspaceId: project.id,
          encryptedSnapshot: encryptedManifest,
        });
      },
    );
  }

  async #saveDocument(
    workspaceId: WorkspaceId,
    document: NoteDocument,
    crypto: WorkspaceStorageCrypto,
    keyEpoch: number,
  ): Promise<void> {
    const encryptedSnapshot =
      await crypto.encryptWorkspaceStoragePayload(
        workspaceId,
        keyEpoch,
        documentContext(document.id),
        document.exportSnapshot(),
      );

    await this.#db.documents.put({
      workspaceId,
      documentId: document.id,
      encryptedSnapshot,
    });
  }
}

function manifestContext(): WorkspaceStorageRecordContext {
  return { kind: "manifest" };
}

function documentContext(
  documentId: DocumentId,
): WorkspaceStorageRecordContext {
  return { kind: "document", documentId };
}
