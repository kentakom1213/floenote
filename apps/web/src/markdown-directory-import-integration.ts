import type { NoteProject, WorkspaceProject } from "@floe-note/document";
import type { OpenWorkspaceResult } from "@floe-note/storage";

import {
  readMarkdownDirectorySelection,
  type BrowserMarkdownDirectoryFile,
} from "./markdown-directory-reader.js";
import {
  commitValidatedImportedProject,
  type ProjectImportDependencies,
} from "./project-import-genesis.js";
import {
  addImportedProjectToWorkspace,
  prepareImportedWorkspace,
} from "./project-import-application.js";

export async function importMarkdownDirectoryIntoWorkspace(
  files: readonly BrowserMarkdownDirectoryFile[],
  workspace: NoteProject,
  importedAt = Date.now(),
): Promise<WorkspaceProject> {
  const imported = await readMarkdownDirectorySelection(files, importedAt);
  return addImportedProjectToWorkspace(workspace, imported);
}

export async function createWorkspaceFromMarkdownDirectory(
  files: readonly BrowserMarkdownDirectoryFile[],
  dependencies: ProjectImportDependencies,
  importedAt = Date.now(),
): Promise<OpenWorkspaceResult> {
  // File enumeration, reads, UTF-8 decoding, and source validation all finish
  // before prepareImportedWorkspace allocates a WorkspaceId or DocumentIds.
  const imported = await readMarkdownDirectorySelection(files, importedAt);
  const workspace = prepareImportedWorkspace(imported);

  return commitValidatedImportedProject(
    workspace,
    dependencies,
    "Markdown directory",
  );
}
