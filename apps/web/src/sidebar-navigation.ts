import type { DocumentId } from "@floe-note/domain";

const STORAGE_KEY = "floe-note-note-sort";

export type NoteSortMode = "updated" | "created" | "title";
export type NoteSortDirection = "asc" | "desc";

export type NoteSortPreference = {
  mode: NoteSortMode;
  direction: NoteSortDirection;
};

export type SidebarNavigationNote = {
  id: DocumentId;
  title: string;
  tags: readonly string[];
  createdAt: number | null;
  updatedAt: number | null;
};

export const DEFAULT_NOTE_SORT: NoteSortPreference = {
  mode: "updated",
  direction: "desc",
};

export function deriveVisibleNotes(
  notes: readonly SidebarNavigationNote[],
  query: string,
  preference: NoteSortPreference,
): SidebarNavigationNote[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const filtered =
    normalizedQuery.length === 0
      ? [...notes]
      : notes.filter((note) => {
          const titleMatches = note.title
            .toLocaleLowerCase()
            .includes(normalizedQuery);
          const tagMatches = note.tags.some((tag) =>
            tag.toLocaleLowerCase().includes(normalizedQuery),
          );
          return titleMatches || tagMatches;
        });

  return filtered
    .map((note, index) => ({ note, index }))
    .sort((left, right) => {
      const compared = compareNotes(left.note, right.note, preference);
      return compared === 0 ? left.index - right.index : compared;
    })
    .map(({ note }) => note);
}

export function selectNextDocumentAfterDeletion(
  before: readonly { id: DocumentId }[],
  remaining: readonly { id: DocumentId }[],
  deletedId: DocumentId,
): DocumentId | null {
  const deletedIndex = before.findIndex(({ id }) => id === deletedId);
  if (deletedIndex < 0) return null;

  return (
    remaining[
      Math.min(deletedIndex, Math.max(remaining.length - 1, 0))
    ]?.id ?? null
  );
}

export function readNoteSortPreference(): NoteSortPreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_NOTE_SORT;
    return normalizeNoteSortPreference(JSON.parse(stored));
  } catch {
    return DEFAULT_NOTE_SORT;
  }
}

export function writeNoteSortPreference(
  preference: NoteSortPreference,
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeNoteSortPreference(preference)),
    );
  } catch {
    // Navigation preferences are best-effort only.
  }
}

export function clearNoteSortPreference(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Navigation preferences are best-effort only.
  }
}

export function normalizeNoteSortPreference(
  value: unknown,
): NoteSortPreference {
  if (!value || typeof value !== "object") return DEFAULT_NOTE_SORT;

  const candidate = value as Partial<NoteSortPreference>;
  const mode =
    candidate.mode === "updated" ||
    candidate.mode === "created" ||
    candidate.mode === "title"
      ? candidate.mode
      : DEFAULT_NOTE_SORT.mode;
  const direction =
    candidate.direction === "asc" || candidate.direction === "desc"
      ? candidate.direction
      : DEFAULT_NOTE_SORT.direction;

  return { mode, direction };
}

function compareNotes(
  left: SidebarNavigationNote,
  right: SidebarNavigationNote,
  preference: NoteSortPreference,
): number {
  let compared: number;

  switch (preference.mode) {
    case "updated":
      compared = compareNumbers(left.updatedAt ?? 0, right.updatedAt ?? 0);
      break;
    case "created":
      compared = compareNumbers(left.createdAt ?? 0, right.createdAt ?? 0);
      break;
    case "title":
      compared = left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      break;
  }

  return preference.direction === "asc" ? compared : -compared;
}

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
