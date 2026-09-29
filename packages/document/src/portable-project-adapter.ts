import type { ProjectId } from "@floe-note/domain";

import type { PortableProject } from "./portable-export.js";
import type { NoteProject } from "./project.js";

export function createPortableProjectSnapshot(
  workspace: NoteProject,
  projectId: ProjectId,
): PortableProject {
  const project = workspace.getProject(projectId);
  if (!project) throw new Error(`Project is unavailable: ${projectId}`);

  return {
    name: project.name,
    documents: workspace.listDocuments()
      .filter(({ id }) => workspace.getDocumentProjectId(id) === projectId)
      .map(({ id }) => {
        const document = workspace.getDocument(id);
        if (!document) {
          throw new Error(`Active document is unavailable: ${id}`);
        }

        const createdAt = requireTimestamp(document.createdAt, id, "createdAt");
        const updatedAt = requireTimestamp(document.updatedAt, id, "updatedAt");

        return {
          title: document.title,
          body: document.bodyText,
          createdAt,
          updatedAt,
          tags: [...document.tags],
        };
      }),
  };
}

function requireTimestamp(
  value: number | null,
  documentId: string,
  field: "createdAt" | "updatedAt",
): number {
  if (value === null) {
    throw new Error(
      `Document ${documentId} is missing required ${field} metadata`,
    );
  }

  return value;
}
