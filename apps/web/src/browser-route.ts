import {
  parseDocumentId,
  parseProjectId,
  parseWorkspaceId,
  type DocumentId,
  type ProjectId,
  type WorkspaceId,
} from "@floe-note/domain";

export type BrowserRoute =
  | { kind: "root" }
  | { kind: "device-settings" }
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "note"; workspaceId: WorkspaceId; noteId: DocumentId }
  | { kind: "workspace-settings"; workspaceId: WorkspaceId }
  | {
      kind: "project-settings";
      workspaceId: WorkspaceId;
      projectId: ProjectId;
    }
  | { kind: "trash"; workspaceId: WorkspaceId }
  | { kind: "trash-note"; workspaceId: WorkspaceId; noteId: DocumentId }
  | { kind: "invitation"; inviteId: string; pairingSecret: string | null }
  | { kind: "not-found" };

const INVITE_ID_PATTERN = /^[0-9a-f]{32}$/iu;

export function parseLocation(
  location: Pick<Location, "pathname" | "hash"> = window.location,
): BrowserRoute {
  const segments = location.pathname.split("/").filter(Boolean);

  if (segments.length === 0) return { kind: "root" };
  if (segments.length === 1 && segments[0] === "settings") {
    return { kind: "device-settings" };
  }

  if (segments[0] === "join" && segments[1] === "v1" && segments.length === 3) {
    const inviteId = segments[2]!;
    if (!INVITE_ID_PATTERN.test(inviteId)) return { kind: "not-found" };
    return {
      kind: "invitation",
      inviteId,
      pairingSecret: new URLSearchParams(location.hash.slice(1)).get("s"),
    };
  }

  if (segments[0] !== "w" || segments.length < 2 || segments.length > 5) {
    return { kind: "not-found" };
  }

  let workspaceId: WorkspaceId;
  try {
    workspaceId = parseWorkspaceId(segments[1]!.toLowerCase());
  } catch {
    return { kind: "not-found" };
  }

  if (segments.length === 2) return { kind: "workspace", workspaceId };
  if (segments.length === 3 && segments[2] === "settings") {
    return { kind: "workspace-settings", workspaceId };
  }
  if (
    segments.length === 5 &&
    segments[2] === "settings" &&
    segments[3] === "projects"
  ) {
    try {
      return {
        kind: "project-settings",
        workspaceId,
        projectId: parseProjectId(segments[4]!.toLowerCase()),
      };
    } catch {
      return { kind: "not-found" };
    }
  }
  if (segments.length === 3 && segments[2] === "trash") {
    return { kind: "trash", workspaceId };
  }

  if (segments.length === 4 && segments[2] === "trash") {
    try {
      return {
        kind: "trash-note",
        workspaceId,
        noteId: parseDocumentId(segments[3]!.toLowerCase()),
      };
    } catch {
      return { kind: "not-found" };
    }
  }

  if (segments.length === 4 && segments[2] === "n") {
    try {
      return {
        kind: "note",
        workspaceId,
        noteId: parseDocumentId(segments[3]!.toLowerCase()),
      };
    } catch {
      return { kind: "not-found" };
    }
  }

  return { kind: "not-found" };
}

export function buildWorkspaceUrl(workspaceId: WorkspaceId): string {
  return `/w/${workspaceId}`;
}

export function buildNoteUrl(
  workspaceId: WorkspaceId,
  noteId: DocumentId,
): string {
  return `${buildWorkspaceUrl(workspaceId)}/n/${noteId}`;
}

export function buildWorkspaceSettingsUrl(workspaceId: WorkspaceId): string {
  return `${buildWorkspaceUrl(workspaceId)}/settings`;
}

export function buildProjectSettingsUrl(
  workspaceId: WorkspaceId,
  projectId: ProjectId,
): string {
  return `${buildWorkspaceSettingsUrl(workspaceId)}/projects/${projectId}`;
}

export function buildTrashUrl(workspaceId: WorkspaceId): string {
  return `${buildWorkspaceUrl(workspaceId)}/trash`;
}

export function buildTrashNoteUrl(
  workspaceId: WorkspaceId,
  noteId: DocumentId,
): string {
  return `${buildTrashUrl(workspaceId)}/${noteId}`;
}
