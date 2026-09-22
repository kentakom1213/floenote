import type { ReactNode } from "react";

import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { AppShell } from "./AppShell.js";
import { MarkdownEditor } from "./MarkdownEditor.js";

type NoteWorkspaceProps = {
  project: NoteProject;
  selectedId: DocumentId | null;
  selectedDocument: NoteDocument | undefined;
  projectControl: ReactNode;
  sidebarFooter: ReactNode;
  onCreateDocument: () => void;
  onSelectDocument: (documentId: DocumentId) => void;
  onRenameDocument: (title: string) => void;
  onDeleteDocument: () => void;
};

export function NoteWorkspace({
  project,
  selectedId,
  selectedDocument,
  projectControl,
  sidebarFooter,
  onCreateDocument,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
}: NoteWorkspaceProps) {
  const summaries = project.listDocuments();

  const sidebar = (
    <div className="sidebar-layout">
      <div>
        <header className="brand-row">
          <div className="brand-lockup">
            <span className="floe-mark" aria-hidden="true">
              ◆
            </span>
            <span className="brand-name">Floe Note</span>
          </div>
        </header>

        <div className="project-slot">{projectControl}</div>

        <button
          className="new-note-button"
          type="button"
          onClick={onCreateDocument}
        >
          <span aria-hidden="true">＋</span>
          <span>New note</span>
        </button>

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
      </div>

      <footer className="sidebar-footer">{sidebarFooter}</footer>
    </div>
  );

  return (
    <AppShell sidebar={sidebar}>
      {selectedDocument ? (
        <DocumentPane
          document={selectedDocument}
          onRename={onRenameDocument}
          onDelete={onDeleteDocument}
        />
      ) : (
        <div className="workspace-empty-state">
          <div className="empty-floe" aria-hidden="true">
            ◆
          </div>
          <p>No notes yet.</p>
          <button type="button" onClick={onCreateDocument}>
            Create your first note
          </button>
        </div>
      )}
    </AppShell>
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
        <details className="note-menu">
          <summary className="note-menu-trigger" aria-label="Note actions">
            •••
          </summary>
          <div className="note-menu-popover">
            <button className="danger-menu-item" type="button" onClick={onDelete}>
              Delete note
            </button>
          </div>
        </details>
      </header>
      <MarkdownEditor document={document} />
    </article>
  );
}
