import {
  NoteProject,
  type ImportedPortableProject,
  type WorkspaceProject,
} from "@floe-note/document";

export function addImportedProjectToWorkspace(
  workspace: NoteProject,
  imported: ImportedPortableProject,
): WorkspaceProject {
  const project = workspace.createProject(imported.name);
  for (const document of imported.documents) {
    workspace.createDocumentWithInitialState(document, project.id);
  }
  return project;
}

export function prepareImportedWorkspace(
  imported: ImportedPortableProject,
): NoteProject {
  const workspace = NoteProject.create();
  const initialProject = workspace.listProjects()[0]!;
  workspace.renameWorkspaceProject(initialProject.id, imported.name);

  for (const document of imported.documents) {
    workspace.createDocumentWithInitialState(document, initialProject.id);
  }

  return workspace;
}
