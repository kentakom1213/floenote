import { describe, expect, it } from "vitest";

import { NoteProject, automaticTagColor } from "../src/index.js";

describe("Project-scoped tags", () => {
  it("derives independent namespaces and colors for the same tag string", () => {
    const workspace = NoteProject.create();
    const a = workspace.listProjects()[0]!.id;
    const b = workspace.createProject("B").id;
    workspace.createDocument("A", a).setTags(["research"]);
    workspace.createDocument("B", b).setTags(["research", "todo"]);

    expect(workspace.listProjectTags(a)).toEqual(["research"]);
    expect(workspace.listProjectTags(b)).toEqual(["research", "todo"]);
    workspace.setTagColor(a, "research", "blue");
    workspace.setTagColor(b, "research", "orange");
    expect(workspace.resolveTagColor(a, "research")).toBe("blue");
    expect(workspace.resolveTagColor(b, "research")).toBe("orange");
    workspace.setTagColor(a, "research", "gray");
    expect(workspace.getExplicitTagColor(a, "research")).toBe("gray");
    expect(workspace.resolveTagColor(b, "research")).toBe("orange");
  });

  it("keeps tag strings on moves and resolves destination colors", () => {
    const workspace = NoteProject.create();
    const a = workspace.listProjects()[0]!.id;
    const b = workspace.createProject("B").id;
    const note = workspace.createDocument("Moved", a);
    note.setTags(["research", "todo"]);
    workspace.setTagColor(a, "research", "blue");
    workspace.setTagColor(b, "todo", "orange");

    workspace.moveDocument(note.id, b);

    expect(note.tags).toEqual(["research", "todo"]);
    expect(workspace.resolveTagColor(b, "research")).toBe(automaticTagColor(b, "research"));
    expect(workspace.getExplicitTagColor(b, "research")).toBeUndefined();
    expect(workspace.resolveTagColor(b, "todo")).toBe("orange");
    expect(workspace.resolveTagColor(a, "research")).toBe("blue");
  });

  it("renames active and deleted Notes, merges duplicates, and leaves other Projects alone", () => {
    const workspace = NoteProject.create();
    const a = workspace.listProjects()[0]!.id;
    const b = workspace.createProject("B").id;
    const active = workspace.createDocument("Active", a);
    active.setTags(["research", "papers", "other"]);
    const deleted = workspace.createDocument("Deleted", a);
    deleted.addTag("research");
    workspace.deleteDocument(deleted.id);
    const other = workspace.createDocument("Other Project", b);
    other.addTag("research");

    workspace.renameTag(a, "research", " papers ");

    expect(active.tags).toEqual(["papers", "other"]);
    expect(deleted.tags).toEqual(["papers"]);
    workspace.restoreDocument(deleted.id);
    expect(deleted.tags).toEqual(["papers"]);
    expect(other.tags).toEqual(["research"]);
    expect(workspace.listProjectTags(a)).toEqual(["other", "papers"]);
    expect(() => workspace.renameTag(a, "papers", "  ")).toThrow("Tag must not be empty");
    workspace.renameTag(a, " papers ", "papers");
    expect(active.tags).toEqual(["papers", "other"]);
  });

  it("moves source explicit colors unless the destination already has one", () => {
    const workspace = NoteProject.create();
    const a = workspace.listProjects()[0]!.id;
    workspace.createDocument("Tags", a).setTags(["source", "destination"]);
    workspace.setTagColor(a, "source", "orange");
    workspace.renameTag(a, "source", "destination");
    expect(workspace.getExplicitTagColor(a, "source")).toBeUndefined();
    expect(workspace.getExplicitTagColor(a, "destination")).toBe("orange");

    workspace.createDocument("Tags again", a).addTag("source");
    workspace.setTagColor(a, "source", "pink");
    workspace.setTagColor(a, "destination", "blue");
    workspace.renameTag(a, "source", "destination");
    expect(workspace.getExplicitTagColor(a, "destination")).toBe("blue");
    expect(workspace.getExplicitTagColor(a, "source")).toBeUndefined();

    workspace.createDocument("Automatic", a).addTag("automatic");
    workspace.renameTag(a, "automatic", "renamed");
    expect(workspace.getExplicitTagColor(a, "renamed")).toBeUndefined();
    expect(workspace.resolveTagColor(a, "renamed")).toBe(automaticTagColor(a, "renamed"));
  });
});
