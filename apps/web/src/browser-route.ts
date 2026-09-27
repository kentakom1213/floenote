import {
  parseDocumentId,
  parseWorkspaceId,
  type DocumentId,
  type WorkspaceId,
} from "@floe-note/domain";

export type BrowserRoute =
  | { kind: "root" }
  | { kind: "device-settings" }
  | { kind: "project"; projectId: WorkspaceId }
  | { kind: "document"; projectId: WorkspaceId; documentId: DocumentId }
  | { kind: "project-settings"; projectId: WorkspaceId }
  | { kind: "trash"; projectId: WorkspaceId }
  | { kind: "trash-document"; projectId: WorkspaceId; documentId: DocumentId }
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

  if (segments[0] !== "p" || segments.length < 2 || segments.length > 4) {
    return { kind: "not-found" };
  }

  let projectId: WorkspaceId;
  try {
    projectId = parseWorkspaceId(segments[1]!);
  } catch {
    return { kind: "not-found" };
  }

  if (segments.length === 2) return { kind: "project", projectId };
  if (segments.length === 3 && segments[2] === "settings") {
    return { kind: "project-settings", projectId };
  }
  if (segments.length === 3 && segments[2] === "trash") {
    return { kind: "trash", projectId };
  }

  if (segments.length === 4 && segments[2] === "trash") {
    try {
      return {
        kind: "trash-document",
        projectId,
        documentId: parseDocumentId(segments[3]!),
      };
    } catch {
      return { kind: "not-found" };
    }
  }

  if (segments.length === 3) {
    try {
      return {
        kind: "document",
        projectId,
        documentId: parseDocumentId(segments[2]!),
      };
    } catch {
      return { kind: "not-found" };
    }
  }

  return { kind: "not-found" };
}

export function buildProjectUrl(projectId: WorkspaceId): string {
  return `/p/${projectId}`;
}

export function buildDocumentUrl(
  projectId: WorkspaceId,
  documentId: DocumentId,
): string {
  return `${buildProjectUrl(projectId)}/${documentId}`;
}

export function buildProjectSettingsUrl(projectId: WorkspaceId): string {
  return `${buildProjectUrl(projectId)}/settings`;
}

export function buildTrashUrl(projectId: WorkspaceId): string {
  return `${buildProjectUrl(projectId)}/trash`;
}

export function buildTrashDocumentUrl(
  projectId: WorkspaceId,
  documentId: DocumentId,
): string {
  return `${buildTrashUrl(projectId)}/${documentId}`;
}

