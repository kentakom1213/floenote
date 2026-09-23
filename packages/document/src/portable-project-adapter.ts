import type { PortableProject } from "./portable-export.js";
import type { NoteProject } from "./project.js";

export function createPortableProjectSnapshot(
  project: NoteProject,
): PortableProject {
  return {
    name: project.name,
    documents: project.listDocuments().map(({ id }) => {
      const document = project.getDocument(id);
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
