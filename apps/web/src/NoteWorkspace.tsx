import { useRef, useState, type ReactNode } from "react";

import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { AppShell } from "./AppShell.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { MarkdownEditor } from "./MarkdownEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

type NoteWorkspaceProps = {
  project: NoteProject;
  selectedId: DocumentId | null;
  selectedDocument: NoteDocument | undefined;
  projectControl: ReactNode;
  sidebarFooter: ReactNode;
  mainContent?: ReactNode;
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
  mainContent,
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
      {mainContent ??
        (selectedDocument ? (
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
            <h1>No notes yet</h1>
            <p>Create a note to start writing in this Project.</p>
            <button type="button" onClick={onCreateDocument}>
              Create your first note
            </button>
          </div>
        ))}
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
  const noteMenuRef = useRef<HTMLDetailsElement>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [deleteOpen, setDeleteOpen] = useState(false);
  useDismissibleDetails(noteMenuRef);

  function requestDelete(): void {
    noteMenuRef.current?.removeAttribute("open");
    setDeleteOpen(true);
  }

  return (
    <article className="document-pane">
      <header className="document-header">
        <input
          className="title-input"
          value={document.title}
          placeholder="Untitled"
          onChange={(event) => onRename(event.target.value)}
          aria-label="Note title"
        />

        <div className="document-header-actions">
          <div className="editor-mode-switch" aria-label="Note view">
            <button
              className={mode === "edit" ? "active" : undefined}
              type="button"
              aria-pressed={mode === "edit"}
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
            <button
              className={mode === "preview" ? "active" : undefined}
              type="button"
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
          </div>

          <details className="note-menu" ref={noteMenuRef}>
            <summary className="note-menu-trigger" aria-label="Note actions">
              •••
            </summary>
            <div className="note-menu-popover">
              <button
                className="danger-menu-item"
                type="button"
                onClick={requestDelete}
              >
                Delete note
              </button>
            </div>
          </details>
        </div>
      </header>

      {mode === "edit" ? (
        <MarkdownEditor document={document} />
      ) : (
        <MarkdownPreview document={document} />
      )}

      {deleteOpen ? (
        <ConfirmDialog
          title={`Delete ${document.title.trim() || "this note"}?`}
          description={
            <p>
              This note will be removed from the Project. Trash and recovery
              are not available yet.
            </p>
          }
          confirmLabel="Delete note"
          onConfirm={async () => onDelete()}
          onClose={() => setDeleteOpen(false)}
        />
      ) : null}
    </article>
  );
}
