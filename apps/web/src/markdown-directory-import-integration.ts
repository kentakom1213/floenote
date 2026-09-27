import type { OpenWorkspaceResult } from "@floe-note/storage";

import {
  readMarkdownDirectorySelection,
  type BrowserMarkdownDirectoryFile,
} from "./markdown-directory-reader.js";
import {
  commitValidatedImportedProject,
  type ProjectImportDependencies,
} from "./project-import-genesis.js";
import { prepareImportedProject } from "./portable-import-integration.js";

export async function importMarkdownDirectory(
  files: readonly BrowserMarkdownDirectoryFile[],
  dependencies: ProjectImportDependencies,
  importedAt = Date.now(),
): Promise<OpenWorkspaceResult> {
  // File enumeration, reads, UTF-8 decoding, and source validation all finish
  // before prepareImportedProject allocates a WorkspaceId or DocumentIds.
  const imported = await readMarkdownDirectorySelection(files, importedAt);
  const project = prepareImportedProject(imported);

  return commitValidatedImportedProject(
    project,
    dependencies,
    "Markdown directory",
  );
}
