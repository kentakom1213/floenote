import type { NoteProject } from "@floe-note/document";
import type { DeviceId, DocumentId, WorkspaceId } from "@floe-note/domain";
import type { SecurityState } from "@floe-note/security";

export type OpenWorkspaceResult = {
  // NoteProject remains the legacy name for the Workspace content model.
  project: NoteProject;
  isNew: boolean;
};

export type StoredWorkspaceSummary = {
  id: WorkspaceId;
  name: string;
  createdAt: number;
  isActive: boolean;
};

export type DocumentReplicationObservation = {
  workspaceId: WorkspaceId;
  deviceId: DeviceId;
  documentId: DocumentId;
  frontiers: Uint8Array;
  confirmedAt: number;
};

export type WorkspaceStorageRecordContext =
  | {
      kind: "manifest";
    }
  | {
      kind: "document";
      documentId: DocumentId;
    };

export interface WorkspaceStorageCrypto {
  encryptWorkspaceStoragePayload(
    workspaceId: WorkspaceId,
    keyEpoch: number,
    context: WorkspaceStorageRecordContext,
    plaintext: Uint8Array,
  ): Promise<Uint8Array>;

  decryptWorkspaceStoragePayload(
    workspaceId: WorkspaceId,
    context: WorkspaceStorageRecordContext,
    envelope: Uint8Array,
  ): Promise<{ keyEpoch: number; plaintext: Uint8Array }>;
}

export interface WorkspaceStorage {
  openLastWorkspace(
    crypto: WorkspaceStorageCrypto,
  ): Promise<OpenWorkspaceResult | null>;

  listWorkspaces(
    crypto: WorkspaceStorageCrypto,
  ): Promise<readonly StoredWorkspaceSummary[]>;

  openWorkspace(
    workspaceId: WorkspaceId,
    crypto: WorkspaceStorageCrypto,
  ): Promise<OpenWorkspaceResult>;

  createWorkspace(name: string): Promise<OpenWorkspaceResult>;

  initializeCommittedWorkspace(
    project: NoteProject,
    state: SecurityState,
    crypto: WorkspaceStorageCrypto,
  ): Promise<OpenWorkspaceResult>;

  removeWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceId | null>;

  eraseAllLocalData(): Promise<void>;

  initializeJoinedWorkspace(
    workspaceId: WorkspaceId,
    crypto?: WorkspaceStorageCrypto,
    keyEpoch?: number,
  ): Promise<NoteProject>;

  completeJoinedWorkspaceBootstrap(workspaceId: WorkspaceId): Promise<void>;

  flushPendingWrites(): Promise<void>;

  loadSecurityState(workspaceId: WorkspaceId): Promise<SecurityState | null>;
  saveCommittedSecurityState(state: SecurityState): Promise<void>;

  saveDocumentReplicationObservation(
    observation: DocumentReplicationObservation,
  ): Promise<void>;

  listDocumentReplicationObservations(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<readonly DocumentReplicationObservation[]>;

  watchWorkspace(
    project: NoteProject,
    crypto?: WorkspaceStorageCrypto,
    keyEpoch?: number,
  ): () => void;
}
