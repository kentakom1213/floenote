import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPortableProjectExport,
  createPortableProjectSnapshot,
  NoteProject,
  parsePortableProjectImport,
} from "../src/index.js";

describe("createPortableProjectSnapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies active note bodies and metadata into the portable model", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(100);
    const project = NoteProject.create();
    const researchId = project.listProjects()[0]!.id;
    project.renameWorkspaceProject(researchId, "Research");
    const otherId = project.createProject("Other").id;
    project.createDocument("Other note", otherId);
    project.setTagColor("research", "blue");
    const document = project.createDocument("Paper notes", researchId);

    now.mockReturnValue(200);
    document.setTags(["graph", "research"]);

    now.mockReturnValue(300);
    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "# Paper\n\nMarkdown body.");
    binding.doc.commit();
    await Promise.resolve();

    const snapshot = createPortableProjectSnapshot(project, researchId);

    expect(snapshot).toEqual({
      name: "Research",
      documents: [
        {
          title: "Paper notes",
          body: "# Paper\n\nMarkdown body.",
          createdAt: 100,
          updatedAt: 300,
          tags: ["graph", "research"],
        },
      ],
    });
    expect(snapshot).not.toHaveProperty("tagColors");
    expect(JSON.stringify(snapshot)).not.toContain('"blue"');
    expect(JSON.stringify(snapshot)).not.toContain("Other note");
  });

  it("omits tombstoned documents", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const project = NoteProject.create();
    const active = project.createDocument("Active");
    const deleted = project.createDocument("Deleted");

    project.deleteDocument(deleted.id);

    const snapshot = createPortableProjectSnapshot(project, project.listProjects()[0]!.id);

    expect(snapshot.documents.map(({ title }) => title)).toEqual([active.title]);
  });

  it("omits permanently deleted documents and purge tombstones", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const project = NoteProject.create();
    project.createDocument("Active");
    const purged = project.createDocument("Purged");

    project.deleteDocument(purged.id);
    project.purgeDocument(purged.id);

    const snapshot = createPortableProjectSnapshot(project, project.listProjects()[0]!.id);

    expect(snapshot.documents.map(({ title }) => title)).toEqual(["Active"]);
    expect(JSON.stringify(snapshot)).not.toContain(purged.id);
    expect(JSON.stringify(snapshot)).not.toContain("purgedDocuments");
  });

  it("does not expose Workspace or Document identity", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const project = NoteProject.create();
    const document = project.createDocument("Portable");

    const projectId = project.listProjects()[0]!.id;
    const snapshot = createPortableProjectSnapshot(project, projectId);

    expect(snapshot).not.toHaveProperty("id");
    expect(snapshot).not.toHaveProperty("projectId");
    expect(snapshot).not.toHaveProperty("workspaceId");
    expect(snapshot.documents[0]).not.toHaveProperty("id");
    expect(JSON.stringify(snapshot)).not.toContain(project.id);
    expect(JSON.stringify(snapshot)).not.toContain(projectId);
    expect(JSON.stringify(snapshot)).not.toContain(document.id);
  });

  it("exports only one Project without Workspace or Note identities", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const workspace = NoteProject.create();
    workspace.renameProject("Private Workspace");
    const projectA = workspace.listProjects()[0]!.id;
    workspace.renameWorkspaceProject(projectA, "Research");
    const projectB = workspace.createProject("Other").id;
    const included = workspace.createDocument("Included", projectA);
    workspace.createDocument("Outside", projectB);
    const deleted = workspace.createDocument("Deleted", projectA);
    workspace.deleteDocument(deleted.id);
    const purged = workspace.createDocument("Purged", projectA);
    workspace.deleteDocument(purged.id);
    workspace.purgeDocument(purged.id);

    const exported = createPortableProjectExport(
      createPortableProjectSnapshot(workspace, projectA),
      { exportedAt: 1_700_000_000_000 },
    );
    const imported = parsePortableProjectImport(exported.archive);

    expect(exported.fileName).toBe("Research.floe.zip");
    expect(exported.manifest).toMatchObject({ format: "floe-project", formatVersion: 1, project: { name: "Research" } });
    expect(imported.documents.map(({ title }) => title)).toEqual(["Included"]);
    expect(exported.manifestJson).not.toContain(workspace.id);
    expect(exported.manifestJson).not.toContain(projectA);
    expect(exported.manifestJson).not.toContain(projectB);
    expect(exported.manifestJson).not.toContain(included.id);
    expect(exported.manifestJson).not.toContain("Private Workspace");
    expect(exported.manifestJson).not.toContain("Outside");
    expect(exported.manifestJson).not.toContain("Deleted");
    expect(exported.manifestJson).not.toContain("Purged");
  });
});
