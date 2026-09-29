import {
  NoteProject,
  parsePortableProjectImport,
  type WorkspaceProject,
} from "@floe-note/document";
import type { OpenWorkspaceResult } from "@floe-note/storage";

import {
  commitValidatedImportedProject,
  type ProjectImportDependencies,
} from "./project-import-genesis.js";
import {
  addImportedProjectToWorkspace,
  prepareImportedWorkspace,
} from "./project-import-application.js";

export type PortableImportDependencies = ProjectImportDependencies;

export function importPortableProjectIntoWorkspace(
  archive: Uint8Array,
  workspace: NoteProject,
): WorkspaceProject {
  return addImportedProjectToWorkspace(workspace, parsePortableProjectImport(archive));
}

export async function createWorkspaceFromPortableProjectArchive(
  archive: Uint8Array,
  dependencies: PortableImportDependencies,
): Promise<OpenWorkspaceResult> {
  // Validation must finish before a Workspace identity or document identity is
  // allocated.
  const imported = parsePortableProjectImport(archive);
  const workspace = prepareImportedWorkspace(imported);

  return commitValidatedImportedProject(
    workspace,
    dependencies,
    "Floe export",
  );
}
