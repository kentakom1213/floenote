import {
  NoteDocument,
  NoteProject,
  createPortableProjectExport,
  createPortableProjectSnapshot,
} from "@floe-note/document";
import {
  createDeviceId,
  type DocumentId,
  type WorkspaceId,
} from "@floe-note/domain";
import {
  deriveInitialSecurityState,
  type CreateWorkspaceTransition,
  type DevicePublicIdentity,
  type SecurityState,
} from "@floe-note/security";
import type {
  OpenWorkspaceResult,
  WorkspaceStorageCrypto,
} from "@floe-note/storage";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceFromPortableProjectArchive,
  importPortableProjectIntoWorkspace,
} from "../src/portable-import-integration.js";
import type {
  ProjectGenesisCoordinator,
  ProjectGenesisRuntime,
  ProjectGenesisSession,
  ProjectGenesisStorage,
} from "../src/project-genesis.js";

const ZERO_HASH = new Uint8Array(32);
const runtime: ProjectGenesisRuntime = {
  async hash() {
    return ZERO_HASH.slice();
  },
  async verify() {
    return true;
  },
};

describe("portable Floe import integration", () => {
  it("creates a Personal Workspace with only the imported Project", async () => {
    const source = sourceProject();
    const sourceDocumentIds = source.getAllDocuments().map(({ id }) => id);
    const archive = exportProject(source);
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();

    const result = await createWorkspaceFromPortableProjectArchive(archive, {
      session,
      coordinator,
      storage,
      runtime,
    });

    expect(result.project.id).not.toBe(source.id);
    expect(
      result.project.getAllDocuments().every(
        ({ id }) => !sourceDocumentIds.includes(id),
      ),
    ).toBe(true);
    expect(result.project.name).toBe("Personal");
    expect(result.project.listProjects()).toHaveLength(1);
    expect(result.project.listProjects()[0]).toMatchObject({ name: "Portable source", status: "active" });
    expect(result.project.listProjects()[0]!.id).not.toBe(source.listProjects()[0]!.id);
    expect(projectContents(result.project)).toEqual([
      {
        title: "Duplicate",
        body: "# First\n",
        createdAt: 100,
        updatedAt: 200,
        tags: ["one", "portable"],
      },
      {
        title: "Duplicate",
        body: "---\nkept: as body\n---\n",
        createdAt: 300,
        updatedAt: 400,
        tags: ["two"],
      },
    ]);
    expect(result.isNew).toBe(false);

    expect(coordinator.transitions).toHaveLength(1);
    expect(coordinator.transitions[0]!.workspaceId).toBe(result.project.id);
    expect(coordinator.transitions[0]!.initialDevice.deviceId).toBe(
      session.publicIdentity.deviceId,
    );
    expect(storage.initializeCalls).toBe(1);
    expect(session.createdKeys).toEqual([
      { workspaceId: result.project.id, keyEpoch: 1 },
    ]);

    const state = storage.securityStates.get(result.project.id);
    expect(state).toMatchObject({
      workspaceId: result.project.id,
      sequence: 0,
      keyEpoch: 1,
    });
    expect(state?.devices.map(({ deviceId }) => deviceId)).toEqual([
      session.publicIdentity.deviceId,
    ]);
  });

  it("validates the complete archive before coordinator or persistence work", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();

    await expect(
      createWorkspaceFromPortableProjectArchive(Uint8Array.of(1, 2, 3), {
        session,
        coordinator,
        storage,
        runtime,
      }),
    ).rejects.toThrow();

    expect(coordinator.transitions).toHaveLength(0);
    expect(storage.initializeCalls).toBe(0);
    expect(storage.projects.size).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("explains coordinator network failures after validation", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator(
      new TypeError("NetworkError when attempting to fetch resource."),
    );
    const storage = new FakeStorage();

    await expect(
      createWorkspaceFromPortableProjectArchive(exportProject(sourceProject()), {
        session,
        coordinator,
        storage,
        runtime,
      }),
    ).rejects.toThrow(
      "The Floe export is valid, but the coordinator is unavailable. " +
        "Connect to the coordinator and try the import again.",
    );

    expect(storage.initializeCalls).toBe(0);
    expect(storage.projects.size).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("does not persist a partial Workspace when coordinator commit fails", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator(
      new Error("Coordinator unavailable"),
    );
    const storage = new FakeStorage();

    await expect(
      createWorkspaceFromPortableProjectArchive(exportProject(sourceProject()), {
        session,
        coordinator,
        storage,
        runtime,
      }),
    ).rejects.toThrow("Coordinator unavailable");

    expect(storage.initializeCalls).toBe(0);
    expect(storage.projects.size).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("removes a newly generated local WorkspaceKey if persistence fails", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();
    storage.failure = new Error("Local persistence failed");

    await expect(
      createWorkspaceFromPortableProjectArchive(exportProject(sourceProject()), {
        session,
        coordinator,
        storage,
        runtime,
      }),
    ).rejects.toThrow("Local persistence failed");

    expect(storage.projects.size).toBe(0);
    expect(session.createdKeys).toHaveLength(1);
    expect(session.removedWorkspaceIds).toHaveLength(1);
    expect(session.hasWorkspaceKey(session.createdKeys[0]!.workspaceId, 1)).toBe(
      false,
    );
  });

  it("keeps existing Workspaces while adding the imported Workspace", async () => {
    const storage = new FakeStorage();
    const existing = NoteProject.create();
    existing.renameProject("Existing");
    storage.storeExisting(existing);

    const result = await createWorkspaceFromPortableProjectArchive(
      exportProject(sourceProject()),
      {
        session: new FakeSession(),
        coordinator: new FakeCoordinator(),
        storage,
        runtime,
      },
    );

    expect(storage.projects.has(existing.id)).toBe(true);
    expect(storage.projects.has(result.project.id)).toBe(true);
    expect(storage.projects.size).toBe(2);
  });

  it("reloads the imported Workspace from persisted snapshots", async () => {
    const storage = new FakeStorage();
    const result = await createWorkspaceFromPortableProjectArchive(
      exportProject(sourceProject()),
      {
        session: new FakeSession(),
        coordinator: new FakeCoordinator(),
        storage,
        runtime,
      },
    );

    const reloaded = storage.reload(result.project.id);

    expect(reloaded.id).toBe(result.project.id);
    expect(reloaded.name).toBe("Personal");
    expect(reloaded.listProjects().map(({ name }) => name)).toEqual(["Portable source"]);
    expect(projectContents(reloaded)).toEqual(projectContents(result.project));
  });

  it("round-trips export to import without restoring source identity", async () => {
    const source = sourceProject();
    const imported = await createWorkspaceFromPortableProjectArchive(exportProject(source), {
      session: new FakeSession(),
      coordinator: new FakeCoordinator(),
      storage: new FakeStorage(),
      runtime,
    });

    expect(imported.project.id).not.toBe(source.id);
    expect(imported.project.name).toBe("Personal");
    expect(imported.project.listProjects()[0]!.name).toBe(source.listProjects()[0]!.name);
    expect(projectContents(imported.project)).toEqual(projectContents(source));
  });

  it("imports one fresh Project into an existing Workspace without genesis", () => {
    const source = sourceProject();
    const target = NoteProject.create();
    target.renameProject("Existing Workspace");
    const firstProjectId = target.listProjects()[0]!.id;
    target.createDocument("Existing note", firstProjectId);
    target.createProject("Portable source");
    const deviceId = createDeviceId();
    target.setDeviceDisplayName(deviceId, "Existing device");
    const originalWorkspaceId = target.id;
    const originalDocumentIds = target.getAllDocuments().map(({ id }) => id);
    const sourceDocumentIds = source.getAllDocuments().map(({ id }) => id);

    const imported = importPortableProjectIntoWorkspace(exportProject(source), target);

    expect(target.id).toBe(originalWorkspaceId);
    expect(target.name).toBe("Existing Workspace");
    expect(target.getDeviceDisplayName(deviceId)).toBe("Existing device");
    expect(target.listProjects()).toHaveLength(3);
    expect(target.listProjects().filter(({ name }) => name === "Portable source")).toHaveLength(2);
    expect(target.getProject(firstProjectId)?.name).toBe("Notes");
    expect(imported).toMatchObject({ name: "Portable source", status: "active" });
    expect(imported.id).not.toBe(source.listProjects()[0]!.id);
    const importedNotes = target.listDocuments().filter(
      ({ id }) => target.getDocumentProjectId(id) === imported.id,
    );
    expect(importedNotes).toHaveLength(2);
    expect(importedNotes.every(({ id }) => !sourceDocumentIds.includes(id) && !originalDocumentIds.includes(id))).toBe(true);
    expect(projectContents(target).slice(1)).toEqual(projectContents(source));
    expect(target.getDocumentProjectId(originalDocumentIds[0]!)).toBe(firstProjectId);

    const reloaded = NoteProject.fromSnapshot(
      target.id,
      target.exportManifestSnapshot(),
      target.getAllDocuments().map((document) => NoteDocument.fromSnapshot(document.id, document.exportSnapshot())),
    );
    expect(reloaded.listProjects().map(({ name }) => name).sort()).toEqual(["Notes", "Portable source", "Portable source"].sort());
    expect(reloaded.listDocuments().filter(({ id }) => reloaded.getDocumentProjectId(id) === imported.id)).toHaveLength(2);
  });

  it("leaves an existing Workspace unchanged when the archive is invalid", () => {
    const target = NoteProject.create();
    const before = target.exportManifestSnapshot();
    expect(() => importPortableProjectIntoWorkspace(Uint8Array.of(1, 2, 3), target)).toThrow();
    expect(target.exportManifestSnapshot()).toEqual(before);
    expect(target.listProjects()).toHaveLength(1);
    expect(target.listDocuments()).toHaveLength(0);
  });

  it("adds an active empty Project without creating a Note", () => {
    const workspace = NoteProject.create();
    const archive = createPortableProjectExport(
      { name: "Empty import", documents: [] },
      { exportedAt: 500 },
    ).archive;

    const imported = importPortableProjectIntoWorkspace(archive, workspace);

    expect(imported).toMatchObject({ name: "Empty import", status: "active" });
    expect(workspace.listProjects()).toHaveLength(2);
    expect(workspace.listDocuments()).toHaveLength(0);
  });
});

function sourceProject(): NoteProject {
  const project = NoteProject.create();
  project.renameWorkspaceProject(project.listProjects()[0]!.id, "Portable source");
  project.createDocumentWithInitialState({
    title: "Duplicate",
    body: "# First\n",
    createdAt: 100,
    updatedAt: 200,
    tags: ["one", "portable"],
  });
  project.createDocumentWithInitialState({
    title: "Duplicate",
    body: "---\nkept: as body\n---\n",
    createdAt: 300,
    updatedAt: 400,
    tags: ["two"],
  });
  return project;
}

function exportProject(project: NoteProject): Uint8Array {
  return createPortableProjectExport(createPortableProjectSnapshot(project, project.listProjects()[0]!.id), {
    exportedAt: 500,
  }).archive;
}

function projectContents(project: NoteProject) {
  return project.getAllDocuments().map((document) => ({
    title: document.title,
    body: document.bodyText,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    tags: [...document.tags],
  }));
}

class FakeSession implements ProjectGenesisSession {
  readonly publicIdentity: DevicePublicIdentity = {
    deviceId: createDeviceId(),
    encryptionPublicKey: new Uint8Array(32).fill(1),
    signingPublicKey: new Uint8Array(32).fill(2),
  };
  readonly displayName = "Import device";
  readonly createdKeys: Array<{ workspaceId: WorkspaceId; keyEpoch: number }> = [];
  readonly removedWorkspaceIds: WorkspaceId[] = [];
  readonly #keys = new Set<string>();

  async sign(): Promise<Uint8Array> {
    return new Uint8Array(64);
  }

  async createWorkspaceKeyIfMissing(
    workspaceId: WorkspaceId,
    keyEpoch: number,
  ): Promise<boolean> {
    const key = `${workspaceId}:${keyEpoch}`;
    if (this.#keys.has(key)) return false;
    this.#keys.add(key);
    this.createdKeys.push({ workspaceId, keyEpoch });
    return true;
  }

  hasWorkspaceKey(workspaceId: WorkspaceId, keyEpoch: number): boolean {
    return this.#keys.has(`${workspaceId}:${keyEpoch}`);
  }

  async removeWorkspaceKeys(workspaceId: WorkspaceId): Promise<void> {
    this.removedWorkspaceIds.push(workspaceId);
    for (const key of [...this.#keys]) {
      if (key.startsWith(`${workspaceId}:`)) this.#keys.delete(key);
    }
  }

  async encryptWorkspaceStoragePayload(
    _workspaceId: WorkspaceId,
    _keyEpoch: number,
    _context: Parameters<WorkspaceStorageCrypto["encryptWorkspaceStoragePayload"]>[2],
    plaintext: Uint8Array,
  ): Promise<Uint8Array> {
    return plaintext.slice();
  }

  async decryptWorkspaceStoragePayload(
    _workspaceId: WorkspaceId,
    _context: Parameters<WorkspaceStorageCrypto["decryptWorkspaceStoragePayload"]>[1],
    envelope: Uint8Array,
  ): Promise<{ keyEpoch: number; plaintext: Uint8Array }> {
    return { keyEpoch: 1, plaintext: envelope.slice() };
  }
}

class FakeCoordinator implements ProjectGenesisCoordinator {
  readonly transitions: CreateWorkspaceTransition[] = [];
  constructor(readonly failure: Error | null = null) {}

  async commitCreateWorkspace(
    _workspaceId: WorkspaceId,
    transition: CreateWorkspaceTransition,
  ): Promise<SecurityState> {
    this.transitions.push(transition);
    if (this.failure) throw this.failure;
    return deriveInitialSecurityState(transition, ZERO_HASH);
  }
}

type StoredSnapshot = {
  manifest: Uint8Array;
  documents: Array<{ id: DocumentId; snapshot: Uint8Array }>;
};

class FakeStorage implements ProjectGenesisStorage {
  readonly projects = new Map<WorkspaceId, StoredSnapshot>();
  readonly securityStates = new Map<WorkspaceId, SecurityState>();
  initializeCalls = 0;
  failure: Error | null = null;

  async initializeCommittedWorkspace(
    project: NoteProject,
    state: SecurityState,
  ): Promise<OpenWorkspaceResult> {
    this.initializeCalls += 1;
    if (this.failure) throw this.failure;

    this.projects.set(project.id, snapshot(project));
    this.securityStates.set(project.id, state);
    return { project, isNew: false };
  }

  storeExisting(project: NoteProject): void {
    this.projects.set(project.id, snapshot(project));
  }

  reload(workspaceId: WorkspaceId): NoteProject {
    const stored = this.projects.get(workspaceId);
    if (!stored) throw new Error("Project not found");

    return NoteProject.fromSnapshot(
      workspaceId,
      stored.manifest,
      stored.documents.map(({ id, snapshot: documentSnapshot }) =>
        NoteDocument.fromSnapshot(id, documentSnapshot),
      ),
    );
  }
}

function snapshot(project: NoteProject): StoredSnapshot {
  return {
    manifest: project.exportManifestSnapshot(),
    documents: project.getAllDocuments().map((document) => ({
      id: document.id,
      snapshot: document.exportSnapshot(),
    })),
  };
}
