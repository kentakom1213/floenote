import type { NoteProject } from "@floe-note/document";
import type { DocumentId, ProjectId } from "@floe-note/domain";
import type { SecurityState } from "@floe-note/security";

export type OpenProjectResult = {
  project: NoteProject;
  isNew: boolean;
};

export type StoredProjectSummary = {
  id: ProjectId;
  name: string;
  createdAt: number;
  isActive: boolean;
};

export type ProjectStorageRecordContext =
  | {
      kind: "manifest";
    }
  | {
      kind: "document";
      documentId: DocumentId;
    };

export interface ProjectStorageCrypto {
  encryptProjectStoragePayload(
    projectId: ProjectId,
    keyEpoch: number,
    context: ProjectStorageRecordContext,
    plaintext: Uint8Array,
  ): Promise<Uint8Array>;

  decryptProjectStoragePayload(
    projectId: ProjectId,
    context: ProjectStorageRecordContext,
    envelope: Uint8Array,
  ): Promise<{ keyEpoch: number; plaintext: Uint8Array }>;
}

export interface ProjectStorage {
  openOrCreateProject(
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult>;

  listProjects(
    crypto: ProjectStorageCrypto,
  ): Promise<readonly StoredProjectSummary[]>;

  openProject(
    projectId: ProjectId,
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult>;

  createProject(name: string): Promise<OpenProjectResult>;

  initializeJoinedProject(
    projectId: ProjectId,
    crypto?: ProjectStorageCrypto,
    keyEpoch?: number,
  ): Promise<NoteProject>;

  loadSecurityState(projectId: ProjectId): Promise<SecurityState | null>;
  saveCommittedSecurityState(state: SecurityState): Promise<void>;

  watchProject(
    project: NoteProject,
    crypto?: ProjectStorageCrypto,
    keyEpoch?: number,
  ): () => void;
}
