import type { NoteProject } from "./project.js";
import { createPortableProjectSnapshot } from "./portable-project-adapter.js";
import type { PortableWorkspace } from "./portable-workspace-export.js";

export function createPortableWorkspaceSnapshot(
  workspace: NoteProject,
): PortableWorkspace {
  const projects = workspace.listProjects().filter(({ status }) => status === "active");
  const activeProjects = new Set(projects.map(({ id }) => id));

  // listDocuments() only includes locally available bodies, so check against
  // manifest membership before using the existing portable Project adapter.
  for (const id of workspace.listActiveDocumentIds()) {
    if (!workspace.getDocument(id)) {
      throw new Error(`Active Note is not available locally: ${id}. Sync this Workspace before exporting.`);
    }
    const projectId = workspace.getDocumentProjectId(id);
    if (!projectId || !activeProjects.has(projectId)) {
      throw new Error(`Active Note has no active Project: ${id}`);
    }
  }

  return {
    name: workspace.name,
    projects: projects.map(({ id }) => createPortableProjectSnapshot(workspace, id)),
  };
}
