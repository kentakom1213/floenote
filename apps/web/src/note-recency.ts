import type { DocumentId, WorkspaceId } from "@floe-note/domain";

const STORAGE_PREFIX = "floe-note-note-recency:";
const MAX_STORED_NOTES = 200;

export function readNoteRecency(
  projectId: WorkspaceId,
): Map<DocumentId, number> {
  try {
    const stored = window.localStorage.getItem(storageKey(projectId));
    if (!stored) return new Map();

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }

    const entries = Object.entries(parsed).flatMap(([id, value]) =>
      typeof value === "number" && Number.isFinite(value)
        ? [[id as DocumentId, value] as const]
        : [],
    );

    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function recordNoteOpened(
  projectId: WorkspaceId,
  documentId: DocumentId,
  openedAt = Date.now(),
): void {
  if (!Number.isFinite(openedAt)) return;

  try {
    const recency = readNoteRecency(projectId);
    recency.set(documentId, openedAt);

    const limited = [...recency.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_STORED_NOTES);

    window.localStorage.setItem(
      storageKey(projectId),
      JSON.stringify(Object.fromEntries(limited)),
    );
  } catch {
    // Recent-note history is a disposable device-local UI preference.
  }
}

export function clearAllNoteRecency(): void {
  const keys: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }

  for (const key of keys) {
    window.localStorage.removeItem(key);
  }
}

function storageKey(projectId: WorkspaceId): string {
  return `${STORAGE_PREFIX}${projectId}`;
}
