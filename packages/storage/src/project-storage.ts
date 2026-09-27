import type { NoteProject } from "@floe-note/document";
import type { DocumentId, WorkspaceId } from "@floe-note/domain";
import type { SecurityState } from "@floe-note/security";

export type OpenProjectResult = {
  project: NoteProject;
  isNew: boolean;
};

export type StoredProjectSummary = {
  id: WorkspaceId;
  name: string;
  createdAt: number;
  isActive: boolean;
};

export type WorkspaceStorageRecordContext =
  | {
      kind: "manifest";
    }
  | {
      kind: "document";
      documentId: DocumentId;
    };

export interface ProjectStorageCrypto {
  encryptWorkspaceStoragePayload(
    projectId: WorkspaceId,
    keyEpoch: number,
    context: WorkspaceStorageRecordContext,
    plaintext: Uint8Array,
  ): Promise<Uint8Array>;

  decryptWorkspaceStoragePayload(
    projectId: WorkspaceId,
    context: WorkspaceStorageRecordContext,
    envelope: Uint8Array,
  ): Promise<{ keyEpoch: number; plaintext: Uint8Array }>;
}

export interface ProjectStorage {
  openLastProject(
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult | null>;

  listProjects(
    crypto: ProjectStorageCrypto,
  ): Promise<readonly StoredProjectSummary[]>;

  openProject(
    projectId: WorkspaceId,
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult>;

  createProject(name: string): Promise<OpenProjectResult>;

  initializeCommittedProject(
    project: NoteProject,
    state: SecurityState,
    crypto: ProjectStorageCrypto,
  ): Promise<OpenProjectResult>;

  removeProject(projectId: WorkspaceId): Promise<WorkspaceId | null>;

  eraseAllLocalData(): Promise<void>;

  initializeJoinedProject(
    projectId: WorkspaceId,
    crypto?: ProjectStorageCrypto,
    keyEpoch?: number,
  ): Promise<NoteProject>;

  completeJoinedProjectBootstrap(projectId: WorkspaceId): Promise<void>;

  flushPendingWrites(): Promise<void>;

  loadSecurityState(projectId: WorkspaceId): Promise<SecurityState | null>;
  saveCommittedSecurityState(state: SecurityState): Promise<void>;

  watchProject(
    project: NoteProject,
    crypto?: ProjectStorageCrypto,
    keyEpoch?: number,
  ): () => void;
}
