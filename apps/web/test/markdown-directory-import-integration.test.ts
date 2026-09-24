import { NoteProject } from "@floe-note/document";
import {
  createDeviceId,
  type ProjectId,
} from "@floe-note/domain";
import {
  deriveInitialSecurityState,
  type CreateProjectTransition,
  type DevicePublicIdentity,
  type SecurityState,
} from "@floe-note/security";
import type {
  OpenProjectResult,
  ProjectStorageCrypto,
} from "@floe-note/storage";
import { describe, expect, it } from "vitest";

import {
  importMarkdownDirectory,
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
  it("creates and opens a new coordinator-backed Project", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator();
    const storage = new FakeStorage();

    const result = await importMarkdownDirectory(
      [
        markdownFile("ideas.md", "my-notes/one/ideas.md", "# One\n"),
        markdownFile("ideas.markdown", "my-notes/two/ideas.markdown", "# Two\n"),
      ],
      { session, coordinator, storage, runtime },
      IMPORTED_AT,
    );

    expect(result.isNew).toBe(false);
    expect(result.project.name).toBe("my-notes");
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
    expect(coordinator.transitions[0]!.projectId).toBe(result.project.id);
    expect(storage.initializeCalls).toBe(1);
    expect(storage.projects.has(result.project.id)).toBe(true);
    expect(session.createdKeys).toEqual([
      { projectId: result.project.id, keyEpoch: 1 },
    ]);

    const state = storage.securityStates.get(result.project.id);
    expect(state).toMatchObject({
      projectId: result.project.id,
      sequence: 0,
      keyEpoch: 1,
    });
    expect(state?.devices.map(({ deviceId }) => deviceId)).toEqual([
      session.publicIdentity.deviceId,
    ]);
  });

  it("allocates fresh ProjectIds and DocumentIds for each import", async () => {
    const files = [
      markdownFile("note.md", "notes/note.md", "body"),
    ];

    const first = await importMarkdownDirectory(
      files,
      {
        session: new FakeSession(),
        coordinator: new FakeCoordinator(),
        storage: new FakeStorage(),
        runtime,
      },
      IMPORTED_AT,
    );
    const second = await importMarkdownDirectory(
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
      importMarkdownDirectory(
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
      importMarkdownDirectory(
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
      importMarkdownDirectory(
        [markdownFile("image.png", "notes/image.png", "png")],
        { session, coordinator, storage, runtime },
        IMPORTED_AT,
      ),
    ).rejects.toThrow("No Markdown files were found");

    expect(coordinator.transitions).toHaveLength(0);
    expect(storage.initializeCalls).toBe(0);
    expect(session.createdKeys).toHaveLength(0);
  });

  it("leaves no partial local Project when coordinator commit fails", async () => {
    const session = new FakeSession();
    const coordinator = new FakeCoordinator(
      new Error("Coordinator unavailable"),
    );
    const storage = new FakeStorage();

    await expect(
      importMarkdownDirectory(
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
      importMarkdownDirectory(
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

  it("cleans up the new ProjectKey when persistence fails", async () => {
    const session = new FakeSession();
    const storage = new FakeStorage();
    storage.failure = new Error("Local persistence failed");

    await expect(
      importMarkdownDirectory(
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
    expect(session.removedProjectIds).toEqual([
      session.createdKeys[0]!.projectId,
    ]);
    expect(
      session.hasProjectKey(session.createdKeys[0]!.projectId, 1),
    ).toBe(false);
    expect(storage.projects.size).toBe(0);
  });

  it("preserves existing Projects when import succeeds", async () => {
    const storage = new FakeStorage();
    const existing = NoteProject.create();
    existing.renameProject("Existing");
    storage.storeExisting(existing);

    const result = await importMarkdownDirectory(
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
  readonly createdKeys: Array<{ projectId: ProjectId; keyEpoch: number }> = [];
  readonly removedProjectIds: ProjectId[] = [];
  readonly #keys = new Set<string>();

  async sign(): Promise<Uint8Array> {
    return new Uint8Array(64);
  }

  async createProjectKeyIfMissing(
    projectId: ProjectId,
    keyEpoch: number,
  ): Promise<boolean> {
    const key = `${projectId}:${keyEpoch}`;
    if (this.#keys.has(key)) return false;
    this.#keys.add(key);
    this.createdKeys.push({ projectId, keyEpoch });
    return true;
  }

  hasProjectKey(projectId: ProjectId, keyEpoch: number): boolean {
    return this.#keys.has(`${projectId}:${keyEpoch}`);
  }

  async removeProjectKeys(projectId: ProjectId): Promise<void> {
    this.removedProjectIds.push(projectId);
    for (const key of [...this.#keys]) {
      if (key.startsWith(`${projectId}:`)) this.#keys.delete(key);
    }
  }

  async encryptProjectStoragePayload(
    _projectId: ProjectId,
    _keyEpoch: number,
    _context: Parameters<ProjectStorageCrypto["encryptProjectStoragePayload"]>[2],
    plaintext: Uint8Array,
  ): Promise<Uint8Array> {
    return plaintext.slice();
  }

  async decryptProjectStoragePayload(
    _projectId: ProjectId,
    _context: Parameters<ProjectStorageCrypto["decryptProjectStoragePayload"]>[1],
    envelope: Uint8Array,
  ): Promise<{ keyEpoch: number; plaintext: Uint8Array }> {
    return { keyEpoch: 1, plaintext: envelope.slice() };
  }
}

class FakeCoordinator implements ProjectGenesisCoordinator {
  readonly transitions: CreateProjectTransition[] = [];

  constructor(readonly failure: Error | null = null) {}

  async commitCreateProject(
    _projectId: ProjectId,
    transition: CreateProjectTransition,
  ): Promise<SecurityState> {
    this.transitions.push(transition);
    if (this.failure) throw this.failure;
    return deriveInitialSecurityState(transition, ZERO_HASH);
  }
}

class FakeStorage implements ProjectGenesisStorage {
  readonly projects = new Map<ProjectId, NoteProject>();
  readonly securityStates = new Map<ProjectId, SecurityState>();
  initializeCalls = 0;
  failure: Error | null = null;

  async initializeCommittedProject(
    project: NoteProject,
    state: SecurityState,
  ): Promise<OpenProjectResult> {
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
