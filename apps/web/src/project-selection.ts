import type { NoteProject } from "@floe-note/document";
import type { DocumentId, ProjectId } from "@floe-note/domain";

export function resolveSelectedProjectId(
  workspace: NoteProject,
  activeNoteId: DocumentId | null,
  rememberedProjectId: ProjectId | null,
): ProjectId | null {
  if (activeNoteId && workspace.getDocument(activeNoteId)) {
    const membership = workspace.getDocumentProjectId(activeNoteId);
    if (membership && workspace.getProject(membership)?.status === "active") {
      return membership;
    }
  }
  if (rememberedProjectId && workspace.getProject(rememberedProjectId)?.status === "active") {
    return rememberedProjectId;
  }
  return workspace.listProjects().find((project) => project.status === "active")?.id ?? null;
}

export function firstNoteInProject(
  workspace: NoteProject,
  projectId: ProjectId | null,
): DocumentId | null {
  if (!projectId) return null;
  return workspace.listDocuments().find((note) => workspace.getDocumentProjectId(note.id) === projectId)?.id ?? null;
}
