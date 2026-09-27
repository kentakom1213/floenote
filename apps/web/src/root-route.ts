import type { NoteProject } from "@floe-note/document";
import type { DocumentId, WorkspaceId } from "@floe-note/domain";
import type { StoredWorkspaceSummary } from "@floe-note/storage";

export type RootRouteResolution =
  | { kind: "open-project"; projectId: WorkspaceId }
  | {
      kind: "canonical-project";
      projectId: WorkspaceId;
      documentId: DocumentId | null;
    }
  | { kind: "empty" };

export function resolveRootRoute(
  project: NoteProject | null,
  projectSummaries: readonly StoredWorkspaceSummary[],
  rememberedDocumentId: DocumentId | null,
): RootRouteResolution {
  if (!project) {
    const summary =
      projectSummaries.find((candidate) => candidate.isActive) ??
      projectSummaries[0] ??
      null;

    return summary
      ? { kind: "open-project", projectId: summary.id }
      : { kind: "empty" };
  }

  const documentId =
    rememberedDocumentId && project.getDocument(rememberedDocumentId)
      ? rememberedDocumentId
      : project.listDocuments()[0]?.id ?? null;

  return {
    kind: "canonical-project",
    projectId: project.id,
    documentId,
  };
}
