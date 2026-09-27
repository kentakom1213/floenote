import {
  NoteProject,
  parsePortableProjectImport,
  type ImportedPortableProject,
} from "@floe-note/document";
import type { OpenWorkspaceResult } from "@floe-note/storage";

import {
  commitValidatedImportedProject,
  type ProjectImportDependencies,
} from "./project-import-genesis.js";

export type PortableImportDependencies = ProjectImportDependencies;

export async function importPortableProjectArchive(
  archive: Uint8Array,
  dependencies: PortableImportDependencies,
): Promise<OpenWorkspaceResult> {
  // Validation must finish before a Workspace identity or document identity is
  // allocated.
  const imported = parsePortableProjectImport(archive);
  const project = prepareImportedProject(imported);

  return commitValidatedImportedProject(
    project,
    dependencies,
    "Floe export",
  );
}

export function prepareImportedProject(
  imported: ImportedPortableProject,
): NoteProject {
  const project = NoteProject.create();
  project.renameProject(imported.name);

  for (const document of imported.documents) {
    project.createDocumentWithInitialState({
      title: document.title,
      body: document.body,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      tags: document.tags,
    });
  }

  return project;
}
