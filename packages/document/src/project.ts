import {
  createCheckpointId,
  createDocumentId,
  createProjectId,
  createWorkspaceId,
  parseCheckpointId,
  parseDocumentId,
  parseProjectId,
  type CheckpointId,
  type DocumentId,
  type ProjectId,
  type WorkspaceId,
} from "@floe-note/domain";
import { LoroDoc, LoroMap } from "loro-crdt";

import { NoteDocument, type NoteDocumentInitialState } from "./document.js";

export type DocumentSummary = {
  id: DocumentId;
  title: string;
};

export type WorkspaceProject = {
  id: ProjectId;
  name: string;
  status: "active" | "archived";
  createdAt: number;
};

export type EditHistoryCheckpoint = {
  id: CheckpointId;
  documentId: DocumentId;
  frontiers: Uint8Array;
  createdAt: number;
  restoreSourceCheckpointId: CheckpointId | null;
};

export const TAG_COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "sky",
  "blue",
  "brown",
  "purple",
  "pink",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export const DEFAULT_TAG_COLOR: TagColor = "gray";

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === "string" && TAG_COLORS.includes(value as TagColor);
}

type CreateEditHistoryCheckpointOptions = {
  createdAt?: number;
  restoreSourceCheckpointId?: CheckpointId | null;
};

const DEFAULT_PROJECT_NAME = "Personal";

type Listener = () => void;

export class NoteProject {
  readonly id: WorkspaceId;
  readonly #manifest: LoroDoc;
  readonly #documents: Map<DocumentId, NoteDocument>;
  readonly #listeners = new Set<Listener>();

  private constructor(
    id: WorkspaceId,
    manifest: LoroDoc,
    documents: readonly NoteDocument[],
  ) {
    this.id = id;
    this.#manifest = manifest;
    this.#documents = new Map(
      documents
        .filter(
          (document) =>
            manifest.getMap("purgedDocuments").get(document.id) !== true,
        )
        .map((document) => [document.id, document]),
    );
  }

  static create(id: WorkspaceId = createWorkspaceId()): NoteProject {
    const manifest = new LoroDoc();
    manifest.getMap("documents");
    manifest.getMap("purgedDocuments");
    manifest.getMap("metadata");
    manifest.getMap("deviceDisplayNames");
    manifest.getMap("editHistoryCheckpoints");
    manifest.getMap("tagColors");
    const initialProject = manifest
      .getMap("projects")
      .ensureMergeableMap(createProjectId());
    initialProject.set("name", "Notes");
    initialProject.set("status", "active");
    initialProject.set("createdAt", Date.now());
    manifest.getMap("documentProjects");
    manifest.commit();

    return new NoteProject(id, manifest, []);
  }

  static empty(id: WorkspaceId): NoteProject {
    return new NoteProject(id, new LoroDoc(), []);
  }

  static fromSnapshot(
    id: WorkspaceId,
    manifestSnapshot: Uint8Array,
    documents: readonly NoteDocument[],
  ): NoteProject {
    const project = new NoteProject(
      id,
      LoroDoc.fromSnapshot(manifestSnapshot),
      documents,
    );
    project.#normalizeProjectInvariants();
    return project;
  }

  listProjects(): WorkspaceProject[] {
    return this.#manifest
      .getMap("projects")
      .entries()
      .flatMap(([id, value]) => {
        if (!isProjectMap(value)) return [];
        try {
          const projectId = parseProjectId(id);
          const name = value.get("name");
          const status = value.get("status");
          const createdAt = value.get("createdAt");
          if (
            typeof name !== "string" ||
            (status !== "active" && status !== "archived") ||
            typeof createdAt !== "number" ||
            !Number.isFinite(createdAt)
          ) return [];
          return [{ id: projectId, name, status, createdAt } satisfies WorkspaceProject];
        } catch {
          return [];
        }
      })
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      );
  }

  getProject(id: ProjectId): WorkspaceProject | undefined {
    return this.listProjects().find((project) => project.id === id);
  }

  createProject(name: string, createdAt = Date.now()): WorkspaceProject {
    const normalized = name.trim();
    if (!normalized) throw new TypeError("Project name must not be empty");
    if (!Number.isFinite(createdAt)) throw new TypeError("Project createdAt must be finite");
    const id = createProjectId();
    const project = this.#manifest.getMap("projects").ensureMergeableMap(id);
    project.set("name", normalized);
    project.set("status", "active");
    project.set("createdAt", createdAt);
    this.#commitManifest();
    return { id, name: normalized, status: "active", createdAt };
  }

  renameWorkspaceProject(id: ProjectId, name: string): void {
    const normalized = name.trim();
    if (!normalized) throw new TypeError("Project name must not be empty");
    const project = this.#requireProject(id);
    project.set("name", normalized);
    this.#commitManifest();
  }

  archiveProject(id: ProjectId): void {
    const project = this.#requireProject(id);
    if (this.#hasActiveDocument(id)) {
      throw new Error("Project contains active Notes");
    }
    if (project.get("status") === "archived") return;
    project.set("status", "archived");
    this.#commitManifest();
  }

  reopenProject(id: ProjectId): void {
    const project = this.#requireProject(id);
    if (project.get("status") === "active") return;
    project.set("status", "active");
    this.#commitManifest();
  }

  getDocumentProjectId(id: DocumentId): ProjectId | undefined {
    if (this.isDocumentPurged(id)) return undefined;
    const status = this.#manifest.getMap("documents").get(id);
    if (status !== "active" && status !== "deleted") return undefined;
    const value = this.#manifest.getMap("documentProjects").get(id);
    if (typeof value !== "string") return undefined;
    try {
      const projectId = parseProjectId(value);
      return this.getProject(projectId) ? projectId : undefined;
    } catch {
      return undefined;
    }
  }

  moveDocument(id: DocumentId, projectId: ProjectId): void {
    this.#requireActiveProject(projectId);
    if (this.#manifest.getMap("documents").get(id) !== "active" || this.isDocumentPurged(id)) {
      throw new Error("Note is not active");
    }
    if (this.getDocumentProjectId(id) === projectId) return;
    this.#manifest.getMap("documentProjects").set(id, projectId);
    this.#commitManifest();
  }

  get name(): string {
    const value = this.#manifest.getMap("metadata").get("name");
    return typeof value === "string" && value.trim().length > 0
      ? value
      : DEFAULT_PROJECT_NAME;
  }

  renameProject(name: string): void {
    const normalized = name.trim();
    if (!normalized) {
      throw new TypeError("Workspace name must not be empty");
    }

    this.#manifest.getMap("metadata").set("name", normalized);
    this.#manifest.commit();
    this.#emit();
  }

  getDeviceDisplayName(deviceId: string): string | null {
    const value = this.#manifest.getMap("deviceDisplayNames").get(deviceId);
    return typeof value === "string" && value.trim().length > 0
      ? value
      : null;
  }

  setDeviceDisplayName(deviceId: string, displayName: string): void {
    const normalized = normalizeDisplayName(displayName);
    this.#manifest
      .getMap("deviceDisplayNames")
      .set(deviceId, normalized);
    this.#manifest.commit();
    this.#emit();
  }

  getTagColor(tag: string): TagColor {
    const value = this.#manifest.getMap("tagColors").get(tag);
    return isTagColor(value) ? value : DEFAULT_TAG_COLOR;
  }

  setTagColor(tag: string, color: TagColor): void {
    if (!isTagColor(color)) {
      throw new TypeError("Invalid tag color");
    }

    this.#manifest.getMap("tagColors").set(tag, color);
    this.#manifest.commit();
    this.#emit();
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeManifestLocalUpdates(
    listener: (update: Uint8Array) => void,
  ): () => void {
    return this.#manifest.subscribeLocalUpdates(listener);
  }

  listDocuments(): DocumentSummary[] {
    return this.#listDocumentsByStatus("active");
  }

  listDeletedDocuments(): DocumentSummary[] {
    return this.#listDocumentsByStatus("deleted");
  }

  getAllDocuments(): readonly NoteDocument[] {
    return [...this.#documents.values()];
  }

  listEditHistoryCheckpoints(
    documentId: DocumentId,
  ): EditHistoryCheckpoint[] {
    if (this.isDocumentPurged(documentId)) return [];

    return this.#manifest
      .getMap("editHistoryCheckpoints")
      .entries()
      .flatMap(([id, value]) => {
        const checkpoint = parseEditHistoryCheckpoint(id, value);
        return checkpoint?.documentId === documentId ? [checkpoint] : [];
      })
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          right.id.localeCompare(left.id),
      );
  }

  getEditHistoryCheckpoint(
    checkpointId: CheckpointId,
  ): EditHistoryCheckpoint | null {
    const value = this.#manifest
      .getMap("editHistoryCheckpoints")
      .get(checkpointId);
    const checkpoint = parseEditHistoryCheckpoint(checkpointId, value);
    if (!checkpoint || this.isDocumentPurged(checkpoint.documentId)) {
      return null;
    }
    return checkpoint;
  }

  createEditHistoryCheckpoint(
    documentId: DocumentId,
    options: CreateEditHistoryCheckpointOptions = {},
  ): EditHistoryCheckpoint | null {
    if (this.isDocumentPurged(documentId)) return null;

    const document = this.#documents.get(documentId);
    if (!document) return null;

    const existing = this.listEditHistoryCheckpoints(documentId);
    const frontiers = document.captureHistoryFrontiers();
    if (
      existing.some((checkpoint) =>
        document.matchesHistoryFrontiers(checkpoint.frontiers),
      )
    ) {
      return null;
    }

    const createdAt = options.createdAt ?? Date.now();
    if (!Number.isFinite(createdAt)) {
      throw new TypeError("Checkpoint createdAt must be a finite timestamp");
    }

    const checkpoint: EditHistoryCheckpoint = {
      id: createCheckpointId(),
      documentId,
      frontiers,
      createdAt,
      restoreSourceCheckpointId:
        options.restoreSourceCheckpointId ?? null,
    };

    this.#manifest.getMap("editHistoryCheckpoints").set(checkpoint.id, {
      documentId: checkpoint.documentId,
      frontiers: checkpoint.frontiers,
      createdAt: checkpoint.createdAt,
      restoreSourceCheckpointId: checkpoint.restoreSourceCheckpointId,
    });
    this.#manifest.commit();
    this.#emit();
    return cloneEditHistoryCheckpoint(checkpoint);
  }

  createHistoricalDocument(
    checkpointId: CheckpointId,
  ): NoteDocument | null {
    const checkpoint = this.getEditHistoryCheckpoint(checkpointId);
    if (!checkpoint) return null;

    const document = this.#documents.get(checkpoint.documentId);
    if (!document) return null;

    return document.createHistoricalView(checkpoint.frontiers);
  }

  restoreEditHistoryCheckpoint(
    checkpointId: CheckpointId,
  ): EditHistoryCheckpoint | null {
    const checkpoint = this.getEditHistoryCheckpoint(checkpointId);
    if (!checkpoint) return null;

    const document = this.getDocument(checkpoint.documentId);
    if (!document) return null;

    this.createEditHistoryCheckpoint(document.id);
    if (!document.restoreFromHistoryFrontiers(checkpoint.frontiers)) {
      return null;
    }

    return this.createEditHistoryCheckpoint(document.id, {
      restoreSourceCheckpointId: checkpoint.id,
    });
  }

  exportManifestSnapshot(): Uint8Array {
    this.#manifest.commit();
    return this.#manifest.export({ mode: "snapshot" });
  }

  exportManifestUpdate(): Uint8Array {
    this.#manifest.commit();
    return this.#manifest.export({ mode: "update" });
  }

  importManifestUpdate(update: Uint8Array): void {
    this.#manifest.import(update);
    this.#prunePurgedDocuments();
    const pruned = this.#prunePurgedEditHistory();
    const normalized = this.#normalizeProjectInvariants();
    if (pruned || normalized) {
      this.#manifest.commit();
    }
    this.#emit();
  }

  importDocumentUpdate(
    id: DocumentId,
    update: Uint8Array,
  ): NoteDocument | undefined {
    if (this.isDocumentPurged(id)) return undefined;

    let document = this.#documents.get(id);

    if (!document) {
      document = NoteDocument.empty(id);
      this.#documents.set(id, document);
    }

    document.importUpdate(update);
    this.#emit();
    return document;
  }

  createDocument(title = "Untitled", projectId?: ProjectId): NoteDocument {
    const destination = this.#resolveCreationProject(projectId);
    const id = createDocumentId();
    const document = NoteDocument.create(id, title);
    this.#addDocument(document, destination);
    return document;
  }

  createDocumentWithInitialState(
    initial: NoteDocumentInitialState,
    projectId?: ProjectId,
  ): NoteDocument {
    const destination = this.#resolveCreationProject(projectId);
    const id = createDocumentId();
    const document = NoteDocument.createWithInitialState(id, initial);
    this.#addDocument(document, destination);
    return document;
  }

  getDocument(id: DocumentId): NoteDocument | undefined {
    if (this.isDocumentPurged(id)) return undefined;

    const status = this.#manifest.getMap("documents").get(id);
    return status === "active" ? this.#documents.get(id) : undefined;
  }

  getDeletedDocument(id: DocumentId): NoteDocument | undefined {
    if (this.isDocumentPurged(id)) return undefined;

    const status = this.#manifest.getMap("documents").get(id);
    return status === "deleted" ? this.#documents.get(id) : undefined;
  }

  isDocumentPurged(id: DocumentId): boolean {
    return this.#manifest.getMap("purgedDocuments").get(id) === true;
  }

  renameDocument(id: DocumentId, title: string): void {
    const document = this.getDocument(id);
    if (!document) return;

    document.setTitle(title);
    this.#emit();
  }

  deleteDocument(id: DocumentId): void {
    this.#setDocumentStatus(id, "active", "deleted");
  }

  restoreDocument(id: DocumentId): void {
    this.#setDocumentStatus(id, "deleted", "active");
  }

  purgeDocument(id: DocumentId): void {
    if (this.isDocumentPurged(id)) return;

    const documents = this.#manifest.getMap("documents");
    if (documents.get(id) !== "deleted") return;

    this.#manifest.getMap("purgedDocuments").set(id, true);
    this.#manifest.getMap("documentProjects").delete(id);
    this.#removeEditHistoryForDocument(id);
    this.#documents.delete(id);
    this.#commitManifest();
  }

  #addDocument(document: NoteDocument, projectId: ProjectId): void {
    this.#documents.set(document.id, document);
    this.#manifest.getMap("documentProjects").set(document.id, projectId);
    this.#manifest.getMap("documents").set(document.id, "active");
    this.#commitManifest();
  }

  #listDocumentsByStatus(
    status: "active" | "deleted",
  ): DocumentSummary[] {
    const manifest = this.#manifest.getMap("documents");

    return manifest
      .entries()
      .filter(
        ([id, value]) =>
          value === status && !this.isDocumentPurged(id as DocumentId),
      )
      .flatMap(([id]) => {
        const document = this.#documents.get(id as DocumentId);
        return document ? [{ id: document.id, title: document.title }] : [];
      });
  }

  #setDocumentStatus(
    id: DocumentId,
    expected: "active" | "deleted",
    next: "active" | "deleted",
  ): void {
    if (this.isDocumentPurged(id)) return;

    const manifest = this.#manifest.getMap("documents");
    if (manifest.get(id) !== expected) return;

    manifest.set(id, next);
    this.#commitManifest();
  }

  #resolveCreationProject(projectId: ProjectId | undefined): ProjectId {
    if (projectId) {
      this.#requireActiveProject(projectId);
      return projectId;
    }
    const active = this.listProjects().filter((project) => project.status === "active");
    if (active.length !== 1) {
      throw new Error("An active Project must be selected to create a Note");
    }
    return active[0]!.id;
  }

  #requireProject(id: ProjectId): LoroMap {
    const value = this.#manifest.getMap("projects").get(id);
    if (!isProjectMap(value) || !this.getProject(id)) {
      throw new Error("Project does not exist");
    }
    return value;
  }

  #requireActiveProject(id: ProjectId): void {
    if (this.#requireProject(id).get("status") !== "active") {
      throw new Error("Project is archived");
    }
  }

  #hasActiveDocument(projectId: ProjectId): boolean {
    return this.#manifest
      .getMap("documents")
      .entries()
      .some(
        ([id, status]) =>
          status === "active" &&
          !this.isDocumentPurged(id as DocumentId) &&
          this.#manifest.getMap("documentProjects").get(id) === projectId,
      );
  }

  #normalizeProjectInvariants(): boolean {
    let changed = false;
    for (const project of this.listProjects()) {
      if (project.status === "archived" && this.#hasActiveDocument(project.id)) {
        this.#requireProject(project.id).set("status", "active");
        changed = true;
      }
    }
    return changed;
  }

  #commitManifest(): void {
    this.#normalizeProjectInvariants();
    this.#manifest.commit();
    this.#emit();
  }

  #prunePurgedDocuments(): void {
    for (const documentId of this.#documents.keys()) {
      if (this.isDocumentPurged(documentId)) {
        this.#documents.delete(documentId);
      }
    }
  }

  #removeEditHistoryForDocument(documentId: DocumentId): boolean {
    let changed = false;
    const checkpoints = this.#manifest.getMap("editHistoryCheckpoints");

    for (const [id, value] of checkpoints.entries()) {
      const checkpoint = parseEditHistoryCheckpoint(id, value);
      if (checkpoint?.documentId !== documentId) continue;
      checkpoints.delete(id);
      changed = true;
    }

    return changed;
  }

  #prunePurgedEditHistory(): boolean {
    let changed = false;
    const checkpoints = this.#manifest.getMap("editHistoryCheckpoints");

    for (const [id, value] of checkpoints.entries()) {
      const checkpoint = parseEditHistoryCheckpoint(id, value);
      if (!checkpoint || !this.isDocumentPurged(checkpoint.documentId)) {
        continue;
      }
      checkpoints.delete(id);
      changed = true;
    }

    return changed;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

function isProjectMap(value: unknown): value is LoroMap {
  return value instanceof LoroMap;
}

function normalizeDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized) throw new TypeError("Device name must not be empty");
  if (normalized.length > 80) throw new TypeError("Device name must be 80 characters or fewer");
  return normalized;
}


function parseEditHistoryCheckpoint(
  id: string,
  value: unknown,
): EditHistoryCheckpoint | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Uint8Array
  ) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.documentId !== "string" ||
    !(record.frontiers instanceof Uint8Array) ||
    typeof record.createdAt !== "number" ||
    !Number.isFinite(record.createdAt)
  ) {
    return null;
  }

  let checkpointId: CheckpointId;
  let documentId: DocumentId;
  let restoreSourceCheckpointId: CheckpointId | null = null;

  try {
    checkpointId = parseCheckpointId(id);
    documentId = parseDocumentId(record.documentId);

    if (record.restoreSourceCheckpointId !== null) {
      if (typeof record.restoreSourceCheckpointId !== "string") return null;
      restoreSourceCheckpointId = parseCheckpointId(
        record.restoreSourceCheckpointId,
      );
    }
  } catch {
    return null;
  }

  return {
    id: checkpointId,
    documentId,
    frontiers: record.frontiers.slice(),
    createdAt: record.createdAt,
    restoreSourceCheckpointId,
  };
}

function cloneEditHistoryCheckpoint(
  checkpoint: EditHistoryCheckpoint,
): EditHistoryCheckpoint {
  return {
    ...checkpoint,
    frontiers: checkpoint.frontiers.slice(),
  };
}
