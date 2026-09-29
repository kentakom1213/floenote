/** @vitest-environment jsdom */

import { NoteProject } from "@floe-note/document";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearAllSelectedProjectPreferences,
  readSelectedProjectId,
  writeSelectedProjectId,
} from "../src/project-preference.js";
import { firstNoteInProject, resolveSelectedProjectId } from "../src/project-selection.js";

afterEach(() => window.localStorage.clear());

describe("selected Project", () => {
  it("remembers selection per Workspace and prefers active Note membership", () => {
    const workspace = NoteProject.create();
    const otherWorkspace = NoteProject.create();
    const notesId = workspace.listProjects()[0]!.id;
    const researchId = workspace.createProject("Research").id;
    const note = workspace.createDocument("A", notesId);

    writeSelectedProjectId(workspace.id, researchId);
    expect(readSelectedProjectId(workspace.id)).toBe(researchId);
    expect(readSelectedProjectId(otherWorkspace.id)).toBeNull();
    expect(resolveSelectedProjectId(workspace, null, readSelectedProjectId(workspace.id))).toBe(researchId);
    expect(resolveSelectedProjectId(workspace, note.id, researchId)).toBe(notesId);

    workspace.moveDocument(note.id, researchId);
    expect(resolveSelectedProjectId(workspace, note.id, notesId)).toBe(researchId);
    expect(firstNoteInProject(workspace, notesId)).toBeNull();
    expect(firstNoteInProject(workspace, researchId)).toBe(note.id);

    clearAllSelectedProjectPreferences();
    expect(readSelectedProjectId(workspace.id)).toBeNull();
  });

  it("rejects archived and unknown preferences and allows zero active Projects", () => {
    const workspace = NoteProject.create();
    const notesId = workspace.listProjects()[0]!.id;
    const researchId = workspace.createProject("Research").id;

    workspace.archiveProject(researchId);
    expect(resolveSelectedProjectId(workspace, null, researchId)).toBe(notesId);
    expect(resolveSelectedProjectId(workspace, null, "unknown" as typeof notesId)).toBe(notesId);

    workspace.archiveProject(notesId);
    expect(resolveSelectedProjectId(workspace, null, notesId)).toBeNull();
  });
});
