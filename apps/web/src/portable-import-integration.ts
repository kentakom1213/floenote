import {
  NoteProject,
  parsePortableProjectImport,
  type ImportedPortableProject,
} from "@floe-note/document";
import type { OpenProjectResult } from "@floe-note/storage";

import {
  commitNewProjectGenesis,
  type ProjectGenesisCoordinator,
  type ProjectGenesisRuntime,
  type ProjectGenesisSession,
  type ProjectGenesisStorage,
} from "./project-genesis.js";

export type PortableImportDependencies = {
  session: ProjectGenesisSession;
  coordinator: ProjectGenesisCoordinator;
  storage: ProjectGenesisStorage;
  runtime?: ProjectGenesisRuntime;
};

export async function importPortableProjectArchive(
  archive: Uint8Array,
  dependencies: PortableImportDependencies,
): Promise<OpenProjectResult> {
  // Validation must finish before a Project identity or document identity is
  // allocated.
  const imported = parsePortableProjectImport(archive);
  const project = prepareImportedProject(imported);

  return commitNewProjectGenesis(
    project,
    dependencies.session,
    dependencies.coordinator,
    dependencies.storage,
    dependencies.runtime,
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
