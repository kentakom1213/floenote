import type {
  EditHistoryCheckpoint,
  NoteDocument,
} from "@floe-note/document";
import type { CheckpointId } from "@floe-note/domain";

import { MarkdownEditor } from "./MarkdownEditor.js";

type EditHistoryPanelProps = {
  checkpoints: readonly EditHistoryCheckpoint[];
  selectedCheckpointId: CheckpointId | null;
  onSelectCheckpoint: (checkpointId: CheckpointId) => void;
  onSelectCurrent: () => void;
  onClose: () => void;
};

export function EditHistoryPanel({
  checkpoints,
  selectedCheckpointId,
  onSelectCheckpoint,
  onSelectCurrent,
  onClose,
}: EditHistoryPanelProps) {
  return (
    <aside className="edit-history-panel" aria-label="Edit history">
      <header className="edit-history-panel-header">
        <strong>History</strong>
        <button
          className="edit-history-close"
          type="button"
          aria-label="Close history"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="edit-history-list">
        <button
          className={
            selectedCheckpointId === null
              ? "edit-history-item selected"
              : "edit-history-item"
          }
          type="button"
          onClick={onSelectCurrent}
        >
          <span className="edit-history-current-dot" aria-hidden="true" />
          <span>Current</span>
        </button>

        {checkpoints.length > 0 ? (
          checkpoints.map((checkpoint) => (
            <button
              className={
                checkpoint.id === selectedCheckpointId
                  ? "edit-history-item selected"
                  : "edit-history-item"
              }
              type="button"
              key={checkpoint.id}
              onClick={() => onSelectCheckpoint(checkpoint.id)}
            >
              <span className="edit-history-item-time">
                {formatCheckpointTime(checkpoint.createdAt)}
              </span>
              {checkpoint.restoreSourceCheckpointId ? (
                <span className="edit-history-item-kind">Restored</span>
              ) : null}
            </button>
          ))
        ) : (
          <p className="edit-history-empty">
            Versions appear here after you edit this note.
          </p>
        )}
      </div>
    </aside>
  );
}

type HistoricalVersionViewProps = {
  checkpoint: EditHistoryCheckpoint;
  document: NoteDocument;
  onBackToCurrent: () => void;
  onRestore: () => void;
};

export function HistoricalVersionView({
  checkpoint,
  document,
  onBackToCurrent,
  onRestore,
}: HistoricalVersionViewProps) {
  return (
    <section className="historical-version-view">
      <div className="historical-version-banner">
        <div>
          <strong>Version from {formatCheckpointTime(checkpoint.createdAt)}</strong>
          <span>Read-only historical version</span>
        </div>
        <div className="historical-version-actions">
          <button type="button" onClick={onBackToCurrent}>
            Back to current
          </button>
          <button
            className="historical-version-restore"
            type="button"
            onClick={onRestore}
          >
            Restore this version
          </button>
        </div>
      </div>

      <header className="historical-version-header">
        <h1>{document.title || "Untitled"}</h1>
        {document.tags.length > 0 ? (
          <div className="historical-version-tags" aria-label="Historical tags">
            {document.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </header>

      <MarkdownEditor document={document} readOnly />

      <p className="historical-version-restore-note">
        Restoring applies this content as a new edit. Your current state remains
        available in history.
      </p>
    </section>
  );
}

export function formatCheckpointTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
