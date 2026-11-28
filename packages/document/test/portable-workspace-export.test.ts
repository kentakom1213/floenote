import { describe, expect, it } from "vitest";

import {
  NoteProject,
  createPortableWorkspaceExport,
  createPortableWorkspaceSnapshot,
  parsePortableProjectImport,
} from "../src/index.js";
import { decodeStoredZip } from "../src/zip-reader.js";
import { encodeStoredZip } from "../src/zip.js";

const exportedAt = Date.UTC(2026, 10, 27);
const note = {
  title: "Paper",
  body: "# Paper\nこんにちは\n",
  createdAt: 100,
  updatedAt: 200,
  tags: ["research"],
};

describe("portable Workspace export", () => {
  it("contains ordinary Project exports, including empty Projects", () => {
    const workspace = {
      name: "Personal",
      projects: [
        { name: "Research", documents: [note] },
        { name: "Research", documents: [] },
        { name: "Other / work", documents: [] },
      ],
    };
    const result = createPortableWorkspaceExport(workspace, { exportedAt });
    expect(result.fileName).toBe("Personal.floe-workspace.zip");
    expect(result.manifest).toEqual({
      format: "floe-workspace",
      formatVersion: 1,
      exportedAt: "2026-11-27T00:00:00.000Z",
      workspace: { name: "Personal" },
      projects: [
        { path: "projects/Research" },
        { path: "projects/Research (2)" },
        { path: "projects/Other _ work" },
      ],
    });
    const entries = decodeStoredZip(result.archive);
    expect(entries.map(({ path }) => path)).toEqual([
      "manifest.json",
      "projects/Research/manifest.json",
      "projects/Research/notes/Paper.md",
      "projects/Research (2)/manifest.json",
      "projects/Other _ work/manifest.json",
    ]);
    for (const [i, { path }] of result.manifest.projects.entries()) {
      const projectEntries = entries
        .filter((entry) => entry.path.startsWith(`${path}/`))
        .map((entry) => ({ path: entry.path.slice(path.length + 1), data: entry.data }));
      expect(parsePortableProjectImport(encodeStoredZip(projectEntries))).toEqual(workspace.projects[i]);
    }
    expect(createPortableWorkspaceExport(workspace, { exportedAt }).archive).toEqual(result.archive);
  });

  it("avoids case and Unicode normalization collisions in extracted Project paths", () => {
    const result = createPortableWorkspaceExport({
      name: "Personal",
      projects: ["Research", "research", "Café", "Cafe\u0301"].map((name) => ({ name, documents: [] })),
    }, { exportedAt });
    expect(result.manifest.projects.map(({ path }) => path)).toEqual([
      "projects/Research", "projects/research (2)", "projects/Café", "projects/Cafe\u0301 (2)",
    ]);
  });

  it("supports a Workspace without active Projects", () => {
    const workspace = NoteProject.create();
    workspace.archiveProject(workspace.listProjects()[0]!.id);
    const snapshot = createPortableWorkspaceSnapshot(workspace);
    expect(snapshot.projects).toEqual([]);
    const result = createPortableWorkspaceExport(snapshot, { exportedAt });
    expect(decodeStoredZip(result.archive).map(({ path }) => path)).toEqual(["manifest.json"]);
  });

  it("preserves active content only and excludes runtime identities", () => {
    const workspace = NoteProject.create();
    workspace.renameProject("Private");
    const projectId = workspace.listProjects()[0]!.id;
    const included = workspace.createDocumentWithInitialState(note, projectId);
    const deleted = workspace.createDocument("Deleted", projectId);
    workspace.deleteDocument(deleted.id);
    const archived = workspace.createProject("Archived");
    workspace.archiveProject(archived.id);
    workspace.createProject("Empty");

    const snapshot = createPortableWorkspaceSnapshot(workspace);
    expect(snapshot.name).toBe("Private");
    expect(snapshot.projects.map(({ name }) => name).sort()).toEqual(["Empty", "Notes"]);
    expect(snapshot.projects.find(({ name }) => name === "Notes")?.documents).toEqual([note]);

    const result = createPortableWorkspaceExport(snapshot, { exportedAt });
    const serialized = new TextDecoder().decode(result.archive);
    for (const excluded of [workspace.id, projectId, included.id, deleted.id, "Deleted", "Archived"]) {
      expect(serialized).not.toContain(excluded);
    }
  });

  it("rejects missing active Note bodies even when listDocuments omits them", () => {
    const source = NoteProject.create();
    source.createDocument("Missing");
    const local = NoteProject.fromSnapshot(source.id, source.exportManifestSnapshot(), []);
    expect(local.listDocuments()).toEqual([]);
    expect(() => createPortableWorkspaceSnapshot(local)).toThrow("not available locally");
  });
});
