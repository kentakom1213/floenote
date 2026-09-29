import type { ProjectId, WorkspaceId } from "@floe-note/domain";

const STORAGE_PREFIX = "floe-note-selected-project:";

export function readSelectedProjectId(workspaceId: WorkspaceId): ProjectId | null {
  return window.localStorage.getItem(`${STORAGE_PREFIX}${workspaceId}`) as ProjectId | null;
}

export function writeSelectedProjectId(
  workspaceId: WorkspaceId,
  projectId: ProjectId | null,
): void {
  const key = `${STORAGE_PREFIX}${workspaceId}`;
  if (projectId) window.localStorage.setItem(key, projectId);
  else window.localStorage.removeItem(key);
}

export function clearAllSelectedProjectPreferences(): void {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) window.localStorage.removeItem(key);
}
