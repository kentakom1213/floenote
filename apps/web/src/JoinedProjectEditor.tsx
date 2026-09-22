import { useState } from "react";

import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { MarkdownEditor } from "./MarkdownEditor.js";

type JoinedProjectEditorProps = {
  project: NoteProject;
};

export function JoinedProjectEditor({ project }: JoinedProjectEditorProps) {
  const [selectedId, setSelectedId] = useState<DocumentId | null>(null);
  const summaries = project.listDocuments();

  const selectedDocument = selectedId
    ? project.getDocument(selectedId)
    : undefined;
  const activeId = selectedDocument
    ? selectedId
    : (summaries[0]?.id ?? null);
  const activeDocument = activeId
    ? project.getDocument(activeId)
    : undefined;

  function createDocument() {
    const document = project.createDocument();
    setSelectedId(document.id);
  }

  function deleteSelectedDocument() {
    if (!activeId) return;

    project.deleteDocument(activeId);
    const next = project.listDocuments()[0];
    setSelectedId(next?.id ?? null);
  }

  return (
    <div className="join-editor">
      <aside className="join-editor-sidebar">
        <div className="join-editor-sidebar-header">
          <strong>Joined Project</strong>
          <button
            className="icon-button"
            type="button"
            onClick={createDocument}
            aria-label="Create note in joined Project"
          >
            +
          </button>
        </div>

        <nav className="note-list" aria-label="Joined Project notes">
          {summaries.map((summary) => (
            <button
              className={
                summary.id === activeId ? "note-item selected" : "note-item"
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

      <section className="join-editor-main">
        {activeDocument ? (
          <JoinedDocumentPane
            document={activeDocument}
            onRename={(title) =>
              project.renameDocument(activeDocument.id, title)
            }
            onDelete={deleteSelectedDocument}
          />
        ) : (
          <div className="join-editor-empty">
            <p>No notes yet.</p>
            <button type="button" onClick={createDocument}>
              Create a note
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

type JoinedDocumentPaneProps = {
  document: NoteDocument;
  onRename: (title: string) => void;
  onDelete: () => void;
};

function JoinedDocumentPane({
  document,
  onRename,
  onDelete,
}: JoinedDocumentPaneProps) {
  return (
    <article className="document-pane">
      <header className="document-header">
        <input
          className="title-input"
          value={document.title}
          onChange={(event) => onRename(event.target.value)}
          aria-label="Joined note title"
        />
        <button className="delete-button" type="button" onClick={onDelete}>
          Delete
        </button>
      </header>
      <MarkdownEditor document={document} />
    </article>
  );
}
