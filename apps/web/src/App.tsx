import { useEffect, useMemo, useState } from "react";

import { NoteProject, type NoteDocument } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { MarkdownEditor } from "./MarkdownEditor.js";

export function App() {
  const project = useMemo(() => new NoteProject(), []);
  const [, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<DocumentId | null>(null);

  useEffect(
    () => project.subscribe(() => setRevision((value) => value + 1)),
    [project],
  );

  useEffect(() => {
    if (project.listDocuments().length === 0) {
      const document = project.createDocument("Welcome to Floe Note");
      setSelectedId(document.id);
    }
  }, [project]);

  const summaries = project.listDocuments();
  const selectedDocument = selectedId
    ? project.getDocument(selectedId)
    : undefined;

  function createDocument() {
    const document = project.createDocument();
    setSelectedId(document.id);
  }

  function deleteSelectedDocument() {
    if (!selectedId) return;

    project.deleteDocument(selectedId);
    const next = project.listDocuments()[0];
    setSelectedId(next?.id ?? null);
  }

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
            onClick={createDocument}
            aria-label="Create note"
          >
            +
          </button>
        </div>

        <nav className="note-list" aria-label="Notes">
          {summaries.map((summary) => (
            <button
              className={
                summary.id === selectedId ? "note-item selected" : "note-item"
              }
              key={summary.id}
              type="button"
              onClick={() => setSelectedId(summary.id)}
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
            onRename={(title) =>
              project.renameDocument(selectedDocument.id, title)
            }
            onDelete={deleteSelectedDocument}
          />
        ) : (
          <div className="empty-state">
            <p>No notes yet.</p>
            <button type="button" onClick={createDocument}>
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
