import { useEffect } from "react";

import type { NoteDocument, NoteProject } from "@floe-note/document";

export const EDIT_HISTORY_IDLE_CHECKPOINT_MS = 2 * 60 * 1000;
export const EDIT_HISTORY_CONTINUOUS_CHECKPOINT_MS = 10 * 60 * 1000;

export function useAutomaticEditHistory(
  project: NoteProject,
  document: NoteDocument,
): void {
  useEffect(() => {
    let dirty = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let continuousTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      if (continuousTimer !== null) clearTimeout(continuousTimer);
      idleTimer = null;
      continuousTimer = null;
    };

    const checkpoint = () => {
      clearTimers();
      if (!dirty) return;

      project.createEditHistoryCheckpoint(document.id);
      dirty = false;
    };

    const scheduleAfterLocalEdit = () => {
      dirty = true;

      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(checkpoint, EDIT_HISTORY_IDLE_CHECKPOINT_MS);

      if (continuousTimer === null) {
        continuousTimer = setTimeout(
          checkpoint,
          EDIT_HISTORY_CONTINUOUS_CHECKPOINT_MS,
        );
      }
    };

    const unsubscribe = document.subscribeLocalUserEdits(scheduleAfterLocalEdit);

    return () => {
      unsubscribe();
      clearTimers();

      if (dirty) {
        project.createEditHistoryCheckpoint(document.id);
      }
    };
  }, [document, project]);
}
