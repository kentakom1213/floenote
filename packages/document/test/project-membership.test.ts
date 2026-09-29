import { createProjectId, parseProjectId } from "@floe-note/domain";
import { describe, expect, it, vi } from "vitest";

import { NoteProject } from "../src/project.js";

function replica(source: NoteProject): NoteProject {
  return NoteProject.fromSnapshot(source.id, source.exportManifestSnapshot(), []);
}

describe("Workspace Projects", () => {
  it("creates, lists, renames, archives, and reopens Projects", () => {
    const workspace = NoteProject.create();
    const initial = workspace.listProjects();
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ name: "Notes", status: "active" });
    expect(parseProjectId(initial[0]!.id)).toBe(initial[0]!.id);
    expect(() => parseProjectId("invalid")).toThrow("ProjectId must be a UUIDv7");

    const other = workspace.createProject(" Notes ", 100);
    expect(workspace.listProjects().map((project) => project.name)).toEqual(["Notes", "Notes"]);
    workspace.renameWorkspaceProject(other.id, "Research");
    workspace.archiveProject(other.id);
    expect(workspace.getProject(other.id)).toMatchObject({ name: "Research", status: "archived", createdAt: 100 });
    workspace.reopenProject(other.id);
    expect(workspace.getProject(other.id)?.status).toBe("active");
  });

  it("tracks one membership and moving only changes that membership", () => {
    const workspace = NoteProject.create();
    const first = workspace.listProjects()[0]!;
    const second = workspace.createProject("Research");
    const note = workspace.createDocument("Draft", first.id);
    const before = note.exportSnapshot();

    expect(workspace.getDocumentProjectId(note.id)).toBe(first.id);
    workspace.moveDocument(note.id, second.id);
    expect(workspace.getDocumentProjectId(note.id)).toBe(second.id);
    expect(workspace.getDocument(note.id)).toBe(note);
    expect(note.exportSnapshot()).toEqual(before);
    expect(() => workspace.archiveProject(second.id)).toThrow("Project contains active Notes");

    workspace.deleteDocument(note.id);
    expect(workspace.getDocumentProjectId(note.id)).toBe(second.id);
    workspace.archiveProject(second.id);
    workspace.restoreDocument(note.id);
    expect(workspace.getDocumentProjectId(note.id)).toBe(second.id);
    expect(workspace.getProject(second.id)?.status).toBe("active");
    workspace.deleteDocument(note.id);
    workspace.purgeDocument(note.id);
    expect(workspace.getDocumentProjectId(note.id)).toBeUndefined();
  });

  it("rejects archived or unknown creation and move destinations", () => {
    const workspace = NoteProject.create();
    const active = workspace.listProjects()[0]!;
    const archived = workspace.createProject("Archive");
    workspace.archiveProject(archived.id);
    const note = workspace.createDocument("Note", active.id);

    expect(() => workspace.createDocument("No", archived.id)).toThrow("Project is archived");
    expect(() => workspace.createDocumentWithInitialState({ title: "No" }, archived.id)).toThrow("Project is archived");
    expect(() => workspace.moveDocument(note.id, archived.id)).toThrow("Project is archived");
    expect(() => workspace.createDocument("No", createProjectId())).toThrow("Project does not exist");
    expect(workspace.getDocumentProjectId(note.id)).toBe(active.id);
  });

  it("allows archiving the last empty active Project without reactivating it", () => {
    const workspace = NoteProject.create();
    const only = workspace.listProjects()[0]!;
    workspace.archiveProject(only.id);

    expect(workspace.listProjects().filter((project) => project.status === "active")).toEqual([]);
    expect(() => workspace.createDocument()).toThrow("An active Project must be selected");
    expect(replica(workspace).getProject(only.id)?.status).toBe("archived");
  });

  it("round trips metadata and membership through snapshots and updates", () => {
    const source = NoteProject.create();
    const target = NoteProject.empty(source.id);
    const project = source.createProject("Research", 42);
    const note = source.createDocument("Draft", project.id);
    source.deleteDocument(note.id);
    source.archiveProject(project.id);

    const restored = replica(source);
    target.importManifestUpdate(source.exportManifestUpdate());
    for (const workspace of [restored, target]) {
      expect(workspace.getProject(project.id)).toMatchObject({ name: "Research", status: "archived", createdAt: 42 });
      expect(workspace.getDocumentProjectId(note.id)).toBe(project.id);
      expect(workspace.listProjects()).toHaveLength(2);
    }
  });

  it("merges a rename and an archive as separate Loro fields", () => {
    const base = NoteProject.create();
    const project = base.listProjects()[0]!;
    const renamer = replica(base);
    const archiver = replica(base);

    renamer.renameWorkspaceProject(project.id, "Renamed");
    archiver.archiveProject(project.id);
    renamer.importManifestUpdate(archiver.exportManifestUpdate());
    archiver.importManifestUpdate(renamer.exportManifestUpdate());

    expect(renamer.getProject(project.id)).toMatchObject({ name: "Renamed", status: "archived" });
    expect(archiver.getProject(project.id)).toMatchObject({ name: "Renamed", status: "archived" });
  });

  it("repairs concurrent archive and create after Loro merge", () => {
    const base = NoteProject.create();
    const project = base.listProjects()[0]!;
    const archiver = replica(base);
    const creator = replica(base);

    archiver.archiveProject(project.id);
    const note = creator.createDocument("Concurrent", project.id);
    archiver.importManifestUpdate(creator.exportManifestUpdate());
    creator.importManifestUpdate(archiver.exportManifestUpdate());

    for (const workspace of [archiver, creator]) {
      expect(workspace.getDocumentProjectId(note.id)).toBe(project.id);
      expect(workspace.getProject(project.id)?.status).toBe("active");
    }

    const localUpdates = vi.fn();
    archiver.subscribeManifestLocalUpdates(localUpdates);
    archiver.importManifestUpdate(creator.exportManifestUpdate());
    archiver.importManifestUpdate(creator.exportManifestUpdate());
    expect(localUpdates).not.toHaveBeenCalled();
  });

  it("repairs concurrent archive and move after Loro merge", () => {
    const base = NoteProject.create();
    const destination = base.createProject("Destination");
    const note = base.createDocument("Move", base.listProjects()[0]!.id);
    const archiver = replica(base);
    const mover = replica(base);

    archiver.archiveProject(destination.id);
    mover.moveDocument(note.id, destination.id);
    archiver.importManifestUpdate(mover.exportManifestUpdate());
    mover.importManifestUpdate(archiver.exportManifestUpdate());

    for (const workspace of [archiver, mover]) {
      expect(workspace.getDocumentProjectId(note.id)).toBe(destination.id);
      expect(workspace.getProject(destination.id)?.status).toBe("active");
    }
  });

  it("keeps concurrent archival of different empty Projects and is idempotent", () => {
    const base = NoteProject.create();
    const first = base.listProjects()[0]!;
    const second = base.createProject("Second");
    const left = replica(base);
    const right = replica(base);
    left.archiveProject(first.id);
    right.archiveProject(second.id);

    left.importManifestUpdate(right.exportManifestUpdate());
    right.importManifestUpdate(left.exportManifestUpdate());
    expect(left.listProjects().filter((project) => project.status === "active")).toEqual([]);
    expect(right.listProjects().filter((project) => project.status === "active")).toEqual([]);

    const listener = vi.fn();
    left.subscribeManifestLocalUpdates(listener);
    const update = right.exportManifestUpdate();
    left.importManifestUpdate(update);
    left.importManifestUpdate(update);
    expect(listener).not.toHaveBeenCalled();
  });
});
