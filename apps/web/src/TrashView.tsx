import {
  DEFAULT_TAG_COLOR,
  type NoteDocument,
  type NoteProject,
  type TagColor,
} from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { ConfirmDialog } from "./ConfirmDialog.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { formatNoteTimestamp } from "./NoteProperties.js";
import { TagChip } from "./TagChip.js";

type TrashViewProps = {
  project: NoteProject;
  selectedDocumentId: DocumentId | null;
  onSelectDocument: (documentId: DocumentId) => void;
  onRestoreDocument: (documentId: DocumentId) => void;
  onRequestPermanentDelete: (documentId: DocumentId) => void;
};

export function TrashView({
  project,
  selectedDocumentId,
  onSelectDocument,
  onRestoreDocument,
  onRequestPermanentDelete,
}: TrashViewProps) {
  const selectedDocument = selectedDocumentId
    ? project.getDeletedDocument(selectedDocumentId)
    : undefined;

  if (selectedDocument) {
    return (
      <TrashNotePreview
        document={selectedDocument}
        getTagColor={(tag) => project.resolveTagColor(project.getDocumentProjectId(selectedDocument.id)!, tag)}
        onRestore={() => onRestoreDocument(selectedDocument.id)}
        onRequestPermanentDelete={() =>
          onRequestPermanentDelete(selectedDocument.id)
        }
      />
    );
  }

  const deletedDocuments = project.listDeletedDocuments();

  return (
    <section className="trash-view" aria-labelledby="trash-view-title">
      <header className="trash-view-header">
        <p className="settings-eyebrow">Workspace</p>
        <h1 id="trash-view-title">Trash</h1>
        <p>Deleted notes stay in this Workspace and can be restored.</p>
      </header>

      {deletedDocuments.length === 0 ? (
        <div className="trash-empty-state">
          <h2>Trash is empty</h2>
          <p>Notes you delete will appear here.</p>
        </div>
      ) : (
        <div className="trash-list" aria-label="Deleted notes">
          {deletedDocuments.map((document) => (
            <div className="trash-item" key={document.id}>
              <button
                className="trash-item-open"
                type="button"
                onClick={() => onSelectDocument(document.id)}
              >
                {document.title || "Untitled"}
              </button>
              <div className="trash-item-actions">
                <button
                  className="trash-restore-button"
                  type="button"
                  onClick={() => onRestoreDocument(document.id)}
                >
                  Restore
                </button>
                <button
                  className="trash-delete-button"
                  type="button"
                  onClick={() =>
                    onRequestPermanentDelete(document.id)
                  }
                >
                  Delete permanently
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type TrashNotePreviewProps = {
  document: NoteDocument;
  getTagColor?: (tag: string) => TagColor;
  onRestore: () => void;
  onRequestPermanentDelete: () => void;
};

export function TrashNotePreview({
  document,
  getTagColor = () => DEFAULT_TAG_COLOR,
  onRestore,
  onRequestPermanentDelete,
}: TrashNotePreviewProps) {
  return (
    <article className="trash-note-preview">
      <header className="trash-note-preview-header">
        <div className="trash-note-preview-heading">
          <p className="settings-eyebrow">Trash</p>
          <h1>{document.title || "Untitled"}</h1>
        </div>
        <div className="trash-note-preview-actions">
          <button
            className="trash-preview-restore-button"
            type="button"
            onClick={onRestore}
          >
            Restore
          </button>
          <button
            className="trash-preview-delete-button"
            type="button"
            onClick={onRequestPermanentDelete}
          >
            Delete permanently
          </button>
        </div>
      </header>

      <section
        className="trash-note-properties"
        aria-label="Deleted note properties"
      >
        <div className="trash-note-tags">
          <span className="trash-note-property-label">Tags</span>
          <div className="trash-note-tag-list">
            {document.tags.length > 0 ? (
              document.tags.map((tag) => (
                <TagChip
                  key={tag}
                  tag={tag}
                  color={getTagColor(tag)}
                />
              ))
            ) : (
              <span className="trash-note-property-empty">None</span>
            )}
          </div>
        </div>

        <dl className="trash-note-timestamps">
          <div>
            <dt>Created</dt>
            <dd>{renderTimestamp(document.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{renderTimestamp(document.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <div className="trash-note-preview-body">
        <MarkdownPreview document={document} interactive={false} />
      </div>
    </article>
  );
}

function renderTimestamp(timestamp: number | null) {
  if (timestamp === null) return <span>Unavailable</span>;

  return (
    <time dateTime={new Date(timestamp).toISOString()}>
      {formatNoteTimestamp(timestamp)}
    </time>
  );
}

type PermanentDeleteConfirmationProps = {
  onCancel: () => void;
  onConfirm: () => void;
};

export function PermanentDeleteConfirmation({
  onCancel,
  onConfirm,
}: PermanentDeleteConfirmationProps) {
  return (
    <ConfirmDialog
      title="Permanently delete this note?"
      description={
        <p>
          This note cannot be restored. Offline devices will apply the
          deletion when they reconnect.
        </p>
      }
      confirmLabel="Delete permanently"
      onClose={onCancel}
      onConfirm={async () => onConfirm()}
    />
  );
}
