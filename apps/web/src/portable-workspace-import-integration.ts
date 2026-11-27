import {
  NoteProject,
  parsePortableWorkspaceFiles,
  type ImportedPortableWorkspace,
} from "@floe-note/document";
import { createWorkspaceId } from "@floe-note/domain";
import type { OpenWorkspaceResult } from "@floe-note/storage";

import { addImportedProjectToWorkspace } from "./project-import-application.js";
import {
  commitValidatedImportedProject,
  type ProjectImportDependencies,
} from "./project-import-genesis.js";

export async function readWorkspaceDirectory(
  files: readonly { webkitRelativePath: string; arrayBuffer(): Promise<ArrayBuffer> }[],
): Promise<ImportedPortableWorkspace> {
  if (!files.length) throw new Error("Select a Workspace export directory");
  const root = files[0]!.webkitRelativePath.split("/")[0];
  if (!root || files.some((file) => !file.webkitRelativePath.startsWith(`${root}/`))) {
    throw new Error("Select one Workspace export directory");
  }
  const entries = await Promise.all(files.map(async (file) => ({
    path: file.webkitRelativePath.slice(root.length + 1),
    data: new Uint8Array(await file.arrayBuffer()),
  })));
  return parsePortableWorkspaceFiles(entries);
}

export function preparePortableWorkspace(
  imported: ImportedPortableWorkspace,
): NoteProject {
  const workspace = NoteProject.empty(createWorkspaceId());
  workspace.renameProject(imported.name);
  for (const project of imported.projects) {
    addImportedProjectToWorkspace(workspace, project);
  }
  return workspace;
}

export async function createWorkspaceFromPortableWorkspace(
  imported: ImportedPortableWorkspace,
  dependencies: ProjectImportDependencies,
): Promise<OpenWorkspaceResult> {
  return commitValidatedImportedProject(
    preparePortableWorkspace(imported),
    dependencies,
    "Workspace export",
  );
}
