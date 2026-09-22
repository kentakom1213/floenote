import type { ReactNode } from "react";

import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { MarkdownEditor } from "./MarkdownEditor.js";

type NoteWorkspaceProps = {
  project: NoteProject;
  selectedId: DocumentId | null;
  selectedDocument: NoteDocument | undefined;
  sidebarControls: ReactNode;
  onCreateDocument: () => void;
  onSelectDocument: (documentId: DocumentId) => void;
  onRenameDocument: (title: string) => void;
  onDeleteDocument: () => void;
};

export function NoteWorkspace({
  project,
  selectedId,
  selectedDocument,
  sidebarControls,
  onCreateDocument,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
}: NoteWorkspaceProps) {
  const summaries = project.listDocuments();

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Local-first notes</p>
            <h1>Floe Note</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onCreateDocument}
            aria-label="Create note"
          >
            +
          </button>
        </div>

        {sidebarControls}

        <nav className="note-list" aria-label="Notes">
          {summaries.map((summary) => (
            <button
              className={
                summary.id === selectedId ? "note-item selected" : "note-item"
              }
              key={summary.id}
              type="button"
              onClick={() => onSelectDocument(summary.id)}
            >
              {summary.title || "Untitled"}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        {selectedDocument ? (
          <DocumentPane
            document={selectedDocument}
            onRename={onRenameDocument}
            onDelete={onDeleteDocument}
          />
        ) : (
          <div className="empty-state">
            <p>No notes yet.</p>
            <button type="button" onClick={onCreateDocument}>
              Create a note
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

type DocumentPaneProps = {
  document: NoteDocument;
  onRename: (title: string) => void;
  onDelete: () => void;
};

function DocumentPane({
  document,
  onRename,
  onDelete,
}: DocumentPaneProps) {
  return (
    <article className="document-pane">
      <header className="document-header">
        <input
          className="title-input"
          value={document.title}
          onChange={(event) => onRename(event.target.value)}
          aria-label="Note title"
        />
        <button className="delete-button" type="button" onClick={onDelete}>
          Delete
        </button>
      </header>
      <MarkdownEditor document={document} />
    </article>
  );
}
