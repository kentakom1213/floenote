import { NoteDocument, NoteProject } from "@floe-note/document";
import {
  parseDocumentId,
  parseProjectId,
  type ProjectId,
} from "@floe-note/domain";
import {
  parseSecurityStateWirePayload,
  securityStateToWire,
  type SecurityState,
  type SecurityStateWirePayload,
} from "@floe-note/security";
import Dexie, { type Table } from "dexie";

import type { OpenProjectResult, ProjectStorage } from "./project-storage.js";

const DATABASE_NAME = "floe-note";
const LOCAL_PROJECT_SLOT = "default";
const DETACHED_PROJECT_SLOT_PREFIX = "detached:";

type ProjectRecord = {
  id: string;
  localSlot: string;
  createdAt: number;
};

type ManifestRecord = {
  projectId: string;
  snapshot: Uint8Array;
};

type DocumentRecord = {
  projectId: string;
  documentId: string;
  snapshot: Uint8Array;
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
  }
}

export class DexieProjectStorage implements ProjectStorage {
  readonly #db = new FloeNoteDatabase();
  #openPromise: Promise<OpenProjectResult> | null = null;
  #writeQueue: Promise<void> = Promise.resolve();

  openOrCreateProject(): Promise<OpenProjectResult> {
    this.#openPromise ??= this.#loadOrCreateProject();
    return this.#openPromise;
  }

  async initializeJoinedProject(projectId: ProjectId): Promise<NoteProject> {
    let targetExists = false;

    await this.#db.transaction(
      "rw",
      this.#db.projects,
      this.#db.manifests,
      async () => {
        const current = await this.#db.projects
          .where("localSlot")
          .equals(LOCAL_PROJECT_SLOT)
          .first();
        const target = await this.#db.projects.get(projectId);
        targetExists = target !== undefined;

        if (current && current.id !== projectId) {
          await this.#db.projects.update(current.id, {
            localSlot: `${DETACHED_PROJECT_SLOT_PREFIX}${current.id}`,
          });
        }

        if (target) {
          await this.#db.projects.update(projectId, {
            localSlot: LOCAL_PROJECT_SLOT,
          });
          return;
        }

        const project = NoteProject.create(projectId);
        await this.#db.projects.add({
          id: projectId,
          localSlot: LOCAL_PROJECT_SLOT,
          createdAt: Date.now(),
        });
        await this.#db.manifests.add({
          projectId,
          snapshot: project.exportManifestSnapshot(),
        });
      },
    );

    const project = targetExists
      ? await this.#loadProject(projectId)
      : NoteProject.create(projectId);

    this.#openPromise = Promise.resolve({ project, isNew: false });
    return project;
  }

  async loadSecurityState(
    projectId: ProjectId,
  ): Promise<SecurityState | null> {
    const record = await this.#db.security.get(projectId);
    return record ? parseSecurityStateWirePayload(record, projectId) : null;
  }

  async saveCommittedSecurityState(state: SecurityState): Promise<void> {
    await this.#db.security.put(securityStateToWire(state));
  }

  watchProject(project: NoteProject): () => void {
    const documentSubscriptions = new Map<string, () => void>();

    const attachDocument = (document: NoteDocument) => {
      if (documentSubscriptions.has(document.id)) return;

      const unsubscribe = document.subscribe(() => {
        this.#enqueue(() => this.#saveDocument(project.id, document));
      });
      documentSubscriptions.set(document.id, unsubscribe);
    };

    for (const document of project.getAllDocuments()) {
      attachDocument(document);
    }

    const unsubscribeProject = project.subscribe(() => {
      for (const document of project.getAllDocuments()) {
        attachDocument(document);
      }

      this.#enqueue(() => this.#saveProjectState(project));
    });

    return () => {
      unsubscribeProject();
      for (const unsubscribe of documentSubscriptions.values()) {
        unsubscribe();
      }
    };
  }

  async #loadOrCreateProject(): Promise<OpenProjectResult> {
    const existing = await this.#db.projects
      .where("localSlot")
      .equals(LOCAL_PROJECT_SLOT)
      .first();

    if (existing) {
      return {
        project: await this.#loadProject(parseProjectId(existing.id)),
        isNew: false,
      };
    }

    const project = NoteProject.create();

    await this.#db.transaction(
      "rw",
      this.#db.projects,
      this.#db.manifests,
      async () => {
        await this.#db.projects.add({
          id: project.id,
          localSlot: LOCAL_PROJECT_SLOT,
          createdAt: Date.now(),
        });
        await this.#db.manifests.add({
          projectId: project.id,
          snapshot: project.exportManifestSnapshot(),
        });
      },
    );

    return { project, isNew: true };
  }

  async #loadProject(projectId: ProjectId): Promise<NoteProject> {
    const manifest = await this.#db.manifests.get(projectId);
    if (!manifest) {
      throw new Error("Local project manifest is missing");
    }

    const documentRows = await this.#db.documents
      .where("projectId")
      .equals(projectId)
      .toArray();

    const documents = documentRows.map((record) =>
      NoteDocument.fromSnapshot(
        parseDocumentId(record.documentId),
        record.snapshot,
      ),
    );

    return NoteProject.fromSnapshot(projectId, manifest.snapshot, documents);
  }

  #enqueue(write: () => Promise<void>): void {
    this.#writeQueue = this.#writeQueue
      .then(write)
      .catch((error: unknown) => {
        console.error("Failed to persist Floe Note state", error);
      });
  }

  async #saveProjectState(project: NoteProject): Promise<void> {
    await this.#db.transaction(
      "rw",
      this.#db.manifests,
      this.#db.documents,
      async () => {
        for (const document of project.getAllDocuments()) {
          await this.#db.documents.put({
            projectId: project.id,
            documentId: document.id,
            snapshot: document.exportSnapshot(),
          });
        }

        await this.#db.manifests.put({
          projectId: project.id,
          snapshot: project.exportManifestSnapshot(),
        });
      },
    );
  }

  async #saveDocument(
    projectId: ProjectId,
    document: NoteDocument,
  ): Promise<void> {
    await this.#db.documents.put({
      projectId,
      documentId: document.id,
      snapshot: document.exportSnapshot(),
    });
  }
}
