import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { MarkdownPreview } from "./MarkdownPreview.js";
import { formatNoteTimestamp } from "./NoteProperties.js";

type TrashViewProps = {
  project: NoteProject;
  selectedDocumentId: DocumentId | null;
  onSelectDocument: (documentId: DocumentId) => void;
  onRestoreDocument: (documentId: DocumentId) => void;
};

export function TrashView({
  project,
  selectedDocumentId,
  onSelectDocument,
  onRestoreDocument,
}: TrashViewProps) {
  const selectedDocument = selectedDocumentId
    ? project.getDeletedDocument(selectedDocumentId)
    : undefined;

  if (selectedDocument) {
    return (
      <TrashNotePreview
        document={selectedDocument}
        onRestore={() => onRestoreDocument(selectedDocument.id)}
      />
    );
  }

  const deletedDocuments = project.listDeletedDocuments();

  return (
    <section className="trash-view" aria-labelledby="trash-view-title">
      <header className="trash-view-header">
        <p className="settings-eyebrow">Project</p>
        <h1 id="trash-view-title">Trash</h1>
        <p>Deleted notes stay in this Project and can be restored.</p>
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
              <button
                className="trash-restore-button"
                type="button"
                onClick={() => onRestoreDocument(document.id)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type TrashNotePreviewProps = {
  document: NoteDocument;
  onRestore: () => void;
};

function TrashNotePreview({
  document,
  onRestore,
}: TrashNotePreviewProps) {
  return (
    <article className="trash-note-preview">
      <header className="trash-note-preview-header">
        <div className="trash-note-preview-heading">
          <p className="settings-eyebrow">Trash</p>
          <h1>{document.title || "Untitled"}</h1>
        </div>
        <button
          className="trash-preview-restore-button"
          type="button"
          onClick={onRestore}
        >
          Restore
        </button>
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
                <span className="trash-note-tag" key={tag}>
                  {tag}
                </span>
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
        <MarkdownPreview document={document} />
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
