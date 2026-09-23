import type { DocumentId, ProjectId } from "@floe-note/domain";

const STORAGE_PREFIX = "floe-note-last-document:";

export function readLastDocumentId(projectId: ProjectId): DocumentId | null {
  const value = window.localStorage.getItem(storageKey(projectId));
  return value as DocumentId | null;
}

export function writeLastDocumentId(
  projectId: ProjectId,
  documentId: DocumentId | null,
): void {
  const key = storageKey(projectId);
  if (documentId) {
    window.localStorage.setItem(key, documentId);
  } else {
    window.localStorage.removeItem(key);
  }
}

export function clearAllLastDocumentPreferences(): void {
  const keys: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }

  for (const key of keys) {
    window.localStorage.removeItem(key);
  }
}

function storageKey(projectId: ProjectId): string {
  return `${STORAGE_PREFIX}${projectId}`;
}
