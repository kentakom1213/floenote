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
  OpenProjectResult,
  ProjectStorage,
  ProjectStorageCrypto,
  WorkspaceStorageRecordContext,
  StoredProjectSummary,
} from "./project-storage.js";

const DATABASE_NAME = "floe-note";
const LOCAL_PROJECT_SLOT = "default";
const DETACHED_PROJECT_SLOT_PREFIX = "detached:";
const BOOTSTRAPPING_PROJECT_SLOT_PREFIX = "bootstrapping:";

type ProjectRecord = {
  id: string;
  localSlot: string;
  createdAt: number;
  bootstrapState?: "bootstrapping" | "ready";
};

type ManifestRecord = {
  projectId: string;
  snapshot?: Uint8Array;
  encryptedSnapshot?: Uint8Array;
};

type DocumentRecord = {
  projectId: string;
  documentId: string;
  snapshot?: Uint8Array;
  encryptedSnapshot?: Uint8Array;
};

class FloeNoteDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>;
  manifests!: Table<ManifestRecord, string>;
  documents!: Table<DocumentRecord, [string, string]>;
  security!: Table<SecurityStateWirePayload, string>;

  constructor() {
    super(DATABASE_NAME);

    this.version(1).stores({
      projects: "&id,&localSlot,createdAt",
      manifests: "&projectId",
      documents: "[projectId+documentId],projectId,documentId",
    });

    this.version(2).stores({
      projects: "&id,&localSlot,createdAt",
      manifests: "&projectId",
      documents: "[projectId+documentId],projectId,documentId",
      security: "&projectId",
    });

    // v3 changes the manifest/document value format without changing indexes.
    // Existing v1/v2 plaintext rows are migrated lazily after Device Vault unlock.
    this.version(3).stores({
      projects: "&id,&localSlot,createdAt",
      manifests: "&projectId",
      documents: "[projectId+documentId],projectId,documentId",
      security: "&projectId",
    });
  }
}

export class DexieProjectStorage implements ProjectStorage {
  readonly #db = new FloeNoteDatabase();
  #writeQueue: Promise<void> = Promise.resolve();
  #writeFailure: Error | null = null;

  openLastProject(
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult | null> {
    return this.#loadLastProject(crypto);
  }

  async listProjects(
    crypto: ProjectStorageCrypto,
  ): Promise<readonly StoredProjectSummary[]> {
    const records = await this.#db.projects.orderBy("createdAt").toArray();

    return Promise.all(
      records
        .filter((record) => record.bootstrapState !== "bootstrapping")
        .map(async (record) => ({
          id: parseWorkspaceId(record.id),
          name: await this.#loadProjectName(
            parseWorkspaceId(record.id),
            crypto,
          ),
          createdAt: record.createdAt,
          isActive: record.localSlot === LOCAL_PROJECT_SLOT,
        })),
    );
  }

  async openProject(
    projectId: WorkspaceId,
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult> {
    const record = await this.#db.projects.get(projectId);
    if (!record) {
      throw new Error("Project is not available on this device");
    }
    if (record.bootstrapState === "bootstrapping") {
      throw new Error("Project setup is incomplete on this device");
    }

    const project = await this.#loadProject(projectId, crypto);
    await this.#activateProject(projectId);
    return { project, isNew: false };
  }

  async createProject(name: string): Promise<OpenProjectResult> {
    const project = NoteProject.create();
    project.renameProject(name);

    await this.#db.transaction("rw", this.#db.projects, async () => {
      const current = await this.#db.projects
        .where("localSlot")
        .equals(LOCAL_PROJECT_SLOT)
        .first();

      if (current) {
        await this.#db.projects.update(current.id, {
          localSlot: `${DETACHED_PROJECT_SLOT_PREFIX}${current.id}`,
        });
      }

      await this.#db.projects.add({
        id: project.id,
        localSlot: LOCAL_PROJECT_SLOT,
        createdAt: Date.now(),
      });
    });

    return { project, isNew: true };
  }

  async initializeCommittedProject(
    project: NoteProject,
    state: SecurityState,
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult> {
    if (state.projectId !== project.id) {
      throw new Error("Committed SecurityState does not match Project");
    }

    await this.#writeQueue;

    const documentRows = await Promise.all(
      project.getAllDocuments().map(async (document) => ({
        projectId: project.id,
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
      this.#db.projects,
      this.#db.manifests,
      this.#db.documents,
      this.#db.security,
      async () => {
        const existing = await this.#db.projects.get(project.id);
        if (existing) {
          throw new Error("Project already exists on this device");
        }

        const current = await this.#db.projects
          .where("localSlot")
          .equals(LOCAL_PROJECT_SLOT)
          .first();

        if (current) {
          await this.#db.projects.update(current.id, {
            localSlot: `${DETACHED_PROJECT_SLOT_PREFIX}${current.id}`,
          });
        }

        await this.#db.projects.add({
          id: project.id,
          localSlot: LOCAL_PROJECT_SLOT,
          createdAt: Date.now(),
        });
        await this.#db.manifests.add({
          projectId: project.id,
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

  async removeProject(projectId: WorkspaceId): Promise<WorkspaceId | null> {
    await this.#writeQueue;

    const record = await this.#db.projects.get(projectId);
    if (!record) return null;

    let nextWorkspaceId: WorkspaceId | null = null;

    await this.#db.transaction(
      "rw",
      this.#db.projects,
      this.#db.manifests,
      this.#db.documents,
      this.#db.security,
      async () => {
        const remaining = await this.#db.projects
          .orderBy("createdAt")
          .filter((candidate) => candidate.id !== projectId)
          .toArray();

        await this.#db.documents
          .where("projectId")
          .equals(projectId)
          .delete();
        await this.#db.manifests.delete(projectId);
        await this.#db.security.delete(projectId);
        await this.#db.projects.delete(projectId);

        if (record.localSlot === LOCAL_PROJECT_SLOT && remaining[0]) {
          await this.#db.projects.update(remaining[0].id, {
            localSlot: LOCAL_PROJECT_SLOT,
          });
          nextWorkspaceId = parseWorkspaceId(remaining[0].id);
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

  async initializeJoinedProject(
    projectId: WorkspaceId,
    crypto?: ProjectStorageCrypto,
    keyEpoch?: number,
  ): Promise<NoteProject> {
    if (!crypto || keyEpoch === undefined) {
      throw new Error(
        "Device Vault and current ProjectKey are required to persist a joined Project",
      );
    }

    await this.#writeQueue;
    this.#writeFailure = null;

    const target = await this.#db.projects.get(projectId);
    if (target && target.bootstrapState !== "bootstrapping") {
      return this.#loadProject(projectId, crypto);
    }

    const emptyProject = NoteProject.create(projectId);
    const emptyEncryptedManifest =
      await crypto.encryptWorkspaceStoragePayload(
        projectId,
        keyEpoch,
        manifestContext(),
        emptyProject.exportManifestSnapshot(),
      );

    await this.#db.transaction(
      "rw",
      this.#db.projects,
      this.#db.manifests,
      this.#db.documents,
      async () => {
        const existing = await this.#db.projects.get(projectId);
        if (existing && existing.bootstrapState !== "bootstrapping") {
          return;
        }

        await this.#db.documents
          .where("projectId")
          .equals(projectId)
          .delete();
        await this.#db.projects.put({
          id: projectId,
          localSlot: `${BOOTSTRAPPING_PROJECT_SLOT_PREFIX}${projectId}`,
          createdAt: existing?.createdAt ?? Date.now(),
          bootstrapState: "bootstrapping",
        });
        await this.#db.manifests.put({
          projectId,
          encryptedSnapshot: emptyEncryptedManifest,
        });
      },
    );

    return emptyProject;
  }

  async completeJoinedProjectBootstrap(
    projectId: WorkspaceId,
  ): Promise<void> {
    await this.#writeQueue;

    await this.#db.transaction("rw", this.#db.projects, async () => {
      const target = await this.#db.projects.get(projectId);
      if (!target) {
        throw new Error("Joined Project is not available on this device");
      }

      const current = await this.#db.projects
        .where("localSlot")
        .equals(LOCAL_PROJECT_SLOT)
        .first();

      if (current && current.id !== projectId) {
        await this.#db.projects.update(current.id, {
          localSlot: `${DETACHED_PROJECT_SLOT_PREFIX}${current.id}`,
        });
      }

      await this.#db.projects.update(projectId, {
        localSlot: LOCAL_PROJECT_SLOT,
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
    projectId: WorkspaceId,
  ): Promise<SecurityState | null> {
    const record = await this.#db.security.get(projectId);
    return record ? parseSecurityStateWirePayload(record, projectId) : null;
  }

  async saveCommittedSecurityState(state: SecurityState): Promise<void> {
    await this.#db.security.put(securityStateToWire(state));
  }

  watchProject(
    project: NoteProject,
    crypto?: ProjectStorageCrypto,
    keyEpoch?: number,
  ): () => void {
    if (!crypto || keyEpoch === undefined) {
      throw new Error(
        "Device Vault and current ProjectKey are required to persist Project data",
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
        this.#saveProjectState(project, crypto, keyEpoch),
      );
    });

    // Persist immediately so legacy plaintext rows and older key epochs are
    // rewritten using the active epoch even if the user makes no edit.
    this.#enqueue(() =>
      this.#saveProjectState(project, crypto, keyEpoch),
    );

    return () => {
      unsubscribeProject();
      for (const unsubscribe of documentSubscriptions.values()) {
        unsubscribe();
      }
    };
  }

  async #loadLastProject(
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult | null> {
    const existing = await this.#db.projects
      .where("localSlot")
      .equals(LOCAL_PROJECT_SLOT)
      .first();

    if (!existing) return null;

    return {
      project: await this.#loadProject(
        parseWorkspaceId(existing.id),
        crypto,
      ),
      isNew: false,
    };
  }

  async #activateProject(projectId: WorkspaceId): Promise<void> {
    await this.#db.transaction("rw", this.#db.projects, async () => {
      const current = await this.#db.projects
        .where("localSlot")
        .equals(LOCAL_PROJECT_SLOT)
        .first();

      if (current && current.id !== projectId) {
        await this.#db.projects.update(current.id, {
          localSlot: `${DETACHED_PROJECT_SLOT_PREFIX}${current.id}`,
        });
      }

      await this.#db.projects.update(projectId, {
        localSlot: LOCAL_PROJECT_SLOT,
      });
    });
  }

  async #loadProjectName(
    projectId: WorkspaceId,
    crypto: ProjectStorageCrypto,
  ): Promise<string> {
    const manifest = await this.#db.manifests.get(projectId);
    if (!manifest) {
      return NoteProject.create(projectId).name;
    }

    const manifestSnapshot = await this.#readSnapshot(
      projectId,
      manifestContext(),
      manifest,
      crypto,
    );

    return NoteProject.fromSnapshot(projectId, manifestSnapshot, []).name;
  }

  async #loadProject(
    projectId: WorkspaceId,
    crypto: ProjectStorageCrypto,
  ): Promise<NoteProject> {
    const manifest = await this.#db.manifests.get(projectId);
    if (!manifest) {
      return NoteProject.create(projectId);
    }

    const manifestSnapshot = await this.#readSnapshot(
      projectId,
      manifestContext(),
      manifest,
      crypto,
    );

    const manifestProject = NoteProject.fromSnapshot(
      projectId,
      manifestSnapshot,
      [],
    );
    const documentRows = await this.#db.documents
      .where("projectId")
      .equals(projectId)
      .toArray();

    const documents = await Promise.all(
      filterLoadableDocumentRows(manifestProject, documentRows).map(
        async (record) => {
          const documentId = parseDocumentId(record.documentId);
          const snapshot = await this.#readSnapshot(
            projectId,
            documentContext(documentId),
            record,
            crypto,
          );
          return NoteDocument.fromSnapshot(documentId, snapshot);
        },
      ),
    );

    return NoteProject.fromSnapshot(
      projectId,
      manifestSnapshot,
      documents,
    );
  }

  async #readSnapshot(
    projectId: WorkspaceId,
    context: WorkspaceStorageRecordContext,
    record: {
      snapshot?: Uint8Array;
      encryptedSnapshot?: Uint8Array;
    },
    crypto: ProjectStorageCrypto,
  ): Promise<Uint8Array> {
    if (record.encryptedSnapshot) {
      const decrypted = await crypto.decryptWorkspaceStoragePayload(
        projectId,
        context,
        record.encryptedSnapshot,
      );
      return decrypted.plaintext;
    }

    if (record.snapshot) {
      return record.snapshot.slice();
    }

    throw new Error("Local Project snapshot is missing");
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

  async #saveProjectState(
    project: NoteProject,
    crypto: ProjectStorageCrypto,
    keyEpoch: number,
  ): Promise<void> {
    const documentRows = await Promise.all(
      project.getAllDocuments().map(async (document) => ({
        projectId: project.id,
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
          .where("projectId")
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
          projectId: project.id,
          encryptedSnapshot: encryptedManifest,
        });
      },
    );
  }

  async #saveDocument(
    projectId: WorkspaceId,
    document: NoteDocument,
    crypto: ProjectStorageCrypto,
    keyEpoch: number,
  ): Promise<void> {
    const encryptedSnapshot =
      await crypto.encryptWorkspaceStoragePayload(
        projectId,
        keyEpoch,
        documentContext(document.id),
        document.exportSnapshot(),
      );

    await this.#db.documents.put({
      projectId,
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
