import type { NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

type TrashViewProps = {
  project: NoteProject;
  onRestoreDocument: (documentId: DocumentId) => void;
};

export function TrashView({
  project,
  onRestoreDocument,
}: TrashViewProps) {
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
              <span className="trash-item-title">
                {document.title || "Untitled"}
              </span>
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
