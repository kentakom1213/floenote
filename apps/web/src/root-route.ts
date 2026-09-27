import type { NoteProject } from "@floe-note/document";
import type { DocumentId, WorkspaceId } from "@floe-note/domain";
import type { StoredWorkspaceSummary } from "@floe-note/storage";

export type RootRouteResolution =
  | { kind: "open-workspace"; workspaceId: WorkspaceId }
  | {
      kind: "canonical-workspace";
      workspaceId: WorkspaceId;
      noteId: DocumentId | null;
    }
  | { kind: "empty" };

export function resolveRootRoute(
  project: NoteProject | null,
  projectSummaries: readonly StoredWorkspaceSummary[],
  rememberedNoteId: DocumentId | null,
): RootRouteResolution {
  if (!project) {
    const summary =
      projectSummaries.find((candidate) => candidate.isActive) ??
      projectSummaries[0] ??
      null;

    return summary
      ? { kind: "open-workspace", workspaceId: summary.id }
      : { kind: "empty" };
  }

  const noteId =
    rememberedNoteId && project.getDocument(rememberedNoteId)
      ? rememberedNoteId
      : project.listDocuments()[0]?.id ?? null;

  return {
    kind: "canonical-workspace",
    workspaceId: project.id,
    noteId,
  };
}
