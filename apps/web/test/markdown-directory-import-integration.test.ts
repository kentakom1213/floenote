import { NoteProject } from "@floe-note/document";
import {
  createDeviceId,
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
  createWorkspaceFromMarkdownDirectory,
  importMarkdownDirectoryIntoWorkspace,
} from "../src/markdown-directory-import-integration.js";
import type { BrowserMarkdownDirectoryFile } from "../src/markdown-directory-reader.js";
import type {
  ProjectGenesisCoordinator,
  ProjectGenesisRuntime,
  ProjectGenesisSession,
  ProjectGenesisStorage,
} from "../src/project-genesis.js";

const IMPORTED_AT = 1_800_000_000_000;
const ZERO_HASH = new Uint8Array(32);
const runtime: ProjectGenesisRuntime = {
  async hash() {
    return ZERO_HASH.slice();
  },
  async verify() {
    return true;
  },
};

describe("Markdown directory import integration", () => {
  it("creates and opens a new coordinator-backed Workspace", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();

    const result = await createWorkspaceFromMarkdownDirectory(
      [
        markdownFile("ideas.md", "my-notes/one/ideas.md", "# One\n"),
        markdownFile("ideas.markdown", "my-notes/two/ideas.markdown", "# Two\n"),
      ],
      { session, coordinator, storage, runtime },
      IMPORTED_AT,
    );

    expect(result.isNew).toBe(false);
    expect(result.project.name).toBe("Personal");
    expect(result.project.listProjects()).toHaveLength(1);
    expect(result.project.listProjects()[0]).toMatchObject({ name: "my-notes", status: "active" });
    expect(result.project.getAllDocuments().map((document) => ({
      title: document.title,
      body: document.bodyText,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      tags: document.tags,
    }))).toEqual([
      {
        title: "ideas",
        body: "# One\n",
        createdAt: IMPORTED_AT,
        updatedAt: IMPORTED_AT,
        tags: [],
      },
      {
        title: "ideas",
        body: "# Two\n",
        createdAt: IMPORTED_AT,
        updatedAt: IMPORTED_AT,
        tags: [],
      },
    ]);

    expect(coordinator.transitions).toHaveLength(1);
    expect(coordinator.transitions[0]!.workspaceId).toBe(result.project.id);
    expect(storage.initializeCalls).toBe(1);
    expect(storage.projects.has(result.project.id)).toBe(true);
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

  it("allocates fresh WorkspaceIds and DocumentIds for each import", async () => {
    const files = [
      markdownFile("note.md", "notes/note.md", "body"),
    ];

    const first = await createWorkspaceFromMarkdownDirectory(
      files,
      {
        session: new FakeSession(),
        coordinator: new FakeCoordinator(),
        storage: new FakeStorage(),
        runtime,
      },
      IMPORTED_AT,
    );
    const second = await createWorkspaceFromMarkdownDirectory(
      files,
      {
        session: new FakeSession(),
        coordinator: new FakeCoordinator(),
        storage: new FakeStorage(),
        runtime,
      },
      IMPORTED_AT,
    );

    expect(first.project.id).not.toBe(second.project.id);
    expect(first.project.getAllDocuments()[0]?.id).not.toBe(
      second.project.getAllDocuments()[0]?.id,
    );
  });

  it("finishes file validation before coordinator or persistence work", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();
    const invalidUtf8: BrowserMarkdownDirectoryFile = {
      name: "broken.md",
      webkitRelativePath: "notes/broken.md",
      async arrayBuffer() {
        return Uint8Array.of(0xc3, 0x28).buffer;
      },
    };

    await expect(
      createWorkspaceFromMarkdownDirectory(
        [invalidUtf8],
        { session, coordinator, storage, runtime },
        IMPORTED_AT,
      ),
    ).rejects.toThrow("Markdown file is not valid UTF-8: broken.md");

    expect(coordinator.transitions).toHaveLength(0);
    expect(storage.initializeCalls).toBe(0);
    expect(storage.projects.size).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("does not silently skip unreadable Markdown files", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();
    const unreadable: BrowserMarkdownDirectoryFile = {
      name: "broken.md",
      webkitRelativePath: "notes/nested/broken.md",
      async arrayBuffer() {
        throw new Error("read failed");
      },
    };

    await expect(
      createWorkspaceFromMarkdownDirectory(
        [unreadable],
        { session, coordinator, storage, runtime },
        IMPORTED_AT,
      ),
    ).rejects.toThrow("Could not read Markdown file: nested/broken.md");

    expect(coordinator.transitions).toHaveLength(0);
    expect(storage.initializeCalls).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("does not start genesis when no Markdown files are importable", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();

    await expect(
      createWorkspaceFromMarkdownDirectory(
        [markdownFile("image.png", "notes/image.png", "png")],
        { session, coordinator, storage, runtime },
        IMPORTED_AT,
      ),
    ).rejects.toThrow("No Markdown files were found");

    expect(coordinator.transitions).toHaveLength(0);
    expect(storage.initializeCalls).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("leaves no partial local Workspace when coordinator commit fails", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator(
      new Error("Coordinator unavailable"),
    );
    const storage = new FakeStorage();

    await expect(
      createWorkspaceFromMarkdownDirectory(
        [markdownFile("note.md", "notes/note.md", "body")],
        { session, coordinator, storage, runtime },
        IMPORTED_AT,
      ),
    ).rejects.toThrow("Coordinator unavailable");

    expect(storage.initializeCalls).toBe(0);
    expect(storage.projects.size).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("uses the same clear coordinator network error semantics as Floe import", async () => {
    const session = new FakeSession();
    const storage = new FakeStorage();

    await expect(
      createWorkspaceFromMarkdownDirectory(
        [markdownFile("note.md", "notes/note.md", "body")],
        {
          session,
          coordinator: new FakeCoordinator(
            new TypeError("NetworkError when attempting to fetch resource."),
          ),
          storage,
          runtime,
        },
        IMPORTED_AT,
      ),
    ).rejects.toThrow(
      "The Markdown directory is valid, but the coordinator is unavailable. " +
        "Connect to the coordinator and try the import again.",
    );

    expect(storage.initializeCalls).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("cleans up the new WorkspaceKey when persistence fails", async () => {
    const session = new FakeSession();
    const storage = new FakeStorage();
    storage.failure = new Error("Local persistence failed");

    await expect(
      createWorkspaceFromMarkdownDirectory(
        [markdownFile("note.md", "notes/note.md", "body")],
        {
          session,
          coordinator: new FakeCoordinator(),
          storage,
          runtime,
        },
        IMPORTED_AT,
      ),
    ).rejects.toThrow("Local persistence failed");

    expect(session.createdKeys).toHaveLength(1);
    expect(session.removedWorkspaceIds).toEqual([
      session.createdKeys[0]!.workspaceId,
    ]);
    expect(
      session.hasWorkspaceKey(session.createdKeys[0]!.workspaceId, 1),
    ).toBe(false);
    expect(storage.projects.size).toBe(0);
  });

  it("preserves existing Workspaces when import succeeds", async () => {
    const storage = new FakeStorage();
    const existing = NoteProject.create();
    existing.renameProject("Existing");
    storage.storeExisting(existing);

    const result = await createWorkspaceFromMarkdownDirectory(
      [markdownFile("note.md", "notes/note.md", "body")],
      {
        session: new FakeSession(),
        coordinator: new FakeCoordinator(),
        storage,
        runtime,
      },
      IMPORTED_AT,
    );

    expect(storage.projects.has(existing.id)).toBe(true);
    expect(storage.projects.has(result.project.id)).toBe(true);
    expect(storage.projects.size).toBe(2);
  });

  it("adds one flattened Project to the current Workspace without Workspace genesis", async () => {
    const workspace = NoteProject.create();
    workspace.renameProject("Existing Workspace");
    const existingProjectId = workspace.listProjects()[0]!.id;
    const existingNoteId = workspace.createDocument("Existing", existingProjectId).id;
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();

    const imported = await importMarkdownDirectoryIntoWorkspace(
      [
        markdownFile("inbox.md", "research/inbox.md", "---\nfrontmatter\n---\n"),
        markdownFile("paper-a.markdown", "research/papers/paper-a.markdown", "# Paper"),
        markdownFile("hidden.md", "research/.hidden/hidden.md", "ignored"),
      ],
      workspace,
      IMPORTED_AT,
    );

    expect(workspace.name).toBe("Existing Workspace");
    expect(workspace.listProjects()).toHaveLength(2);
    expect(imported).toMatchObject({ name: "research", status: "active" });
    expect(workspace.getDocumentProjectId(existingNoteId)).toBe(existingProjectId);
    const importedNotes = workspace.listDocuments().filter(({ id }) => workspace.getDocumentProjectId(id) === imported.id);
    expect(importedNotes.map(({ title }) => title)).toEqual(["inbox", "paper-a"]);
    expect(importedNotes.map(({ id }) => workspace.getDocument(id)?.bodyText)).toEqual(["---\nfrontmatter\n---\n", "# Paper"]);
    expect(importedNotes.every(({ id }) => id !== existingNoteId)).toBe(true);
    expect(importedNotes.map(({ id }) => workspace.getDocument(id)?.createdAt)).toEqual([IMPORTED_AT, IMPORTED_AT]);
    expect(importedNotes.map(({ id }) => workspace.getDocument(id)?.updatedAt)).toEqual([IMPORTED_AT, IMPORTED_AT]);
    expect(importedNotes.map(({ id }) => workspace.getDocument(id)?.tags)).toEqual([[], []]);
    expect(coordinator.transitions).toHaveLength(0);
    expect(storage.initializeCalls).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("leaves the current Workspace unchanged when a Markdown file is invalid", async () => {
    const workspace = NoteProject.create();
    const before = workspace.exportManifestSnapshot();
    const invalidFile: BrowserMarkdownDirectoryFile = {
      name: "broken.md",
      webkitRelativePath: "research/broken.md",
      async arrayBuffer() {
        return Uint8Array.of(0xc3, 0x28).buffer;
      },
    };

    await expect(importMarkdownDirectoryIntoWorkspace([invalidFile], workspace, IMPORTED_AT))
      .rejects.toThrow("Markdown file is not valid UTF-8: broken.md");
    expect(workspace.exportManifestSnapshot()).toEqual(before);
    expect(workspace.listProjects()).toHaveLength(1);
  });
});

function markdownFile(
  name: string,
  webkitRelativePath: string,
  body: string,
): BrowserMarkdownDirectoryFile {
  return {
    name,
    webkitRelativePath,
    async arrayBuffer() {
      return new TextEncoder().encode(body).buffer;
    },
  };
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

class FakeStorage implements ProjectGenesisStorage {
  readonly projects = new Map<WorkspaceId, NoteProject>();
  readonly securityStates = new Map<WorkspaceId, SecurityState>();
  initializeCalls = 0;
  failure: Error | null = null;

  async initializeCommittedWorkspace(
    project: NoteProject,
    state: SecurityState,
  ): Promise<OpenWorkspaceResult> {
    this.initializeCalls += 1;
    if (this.failure) throw this.failure;

    this.projects.set(project.id, project);
    this.securityStates.set(project.id, state);
    return { project, isNew: false };
  }

  storeExisting(project: NoteProject): void {
    this.projects.set(project.id, project);
  }
}
