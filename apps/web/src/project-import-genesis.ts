import type { NoteProject } from "@floe-note/document";
import type { OpenWorkspaceResult } from "@floe-note/storage";

import {
  commitNewProjectGenesis,
  type ProjectGenesisCoordinator,
  type ProjectGenesisRuntime,
  type ProjectGenesisSession,
  type ProjectGenesisStorage,
} from "./project-genesis.js";

export type ProjectImportDependencies = {
  session: ProjectGenesisSession;
  coordinator: ProjectGenesisCoordinator;
  storage: ProjectGenesisStorage;
  runtime?: ProjectGenesisRuntime;
};

export async function commitValidatedImportedProject(
  project: NoteProject,
  dependencies: ProjectImportDependencies,
  sourceLabel: "Floe export" | "Markdown directory",
): Promise<OpenWorkspaceResult> {
  try {
    return await commitNewProjectGenesis(
      project,
      dependencies.session,
      dependencies.coordinator,
      dependencies.storage,
      dependencies.runtime,
    );
  } catch (error: unknown) {
    if (isCoordinatorNetworkError(error)) {
      throw new Error(
        `The ${sourceLabel} is valid, but the coordinator is unavailable. ` +
          "Connect to the coordinator and try the import again.",
        { cause: error },
      );
    }
    throw error;
  }
}

function isCoordinatorNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return [
    "NetworkError when attempting to fetch resource",
    "Failed to fetch",
    "Load failed",
    "fetch failed",
  ].some((message) => error.message.includes(message));
}
