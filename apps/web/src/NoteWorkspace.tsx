import { useEffect, useRef, useState, type ReactNode } from "react";

import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

import { AppShell } from "./AppShell.js";
import { EditorModeView } from "./EditorModeView.js";
import {
  readEditorModePreference,
  writeEditorModePreference,
  type EditorMode,
} from "./editor-mode-preference.js";
import { NoteProperties } from "./NoteProperties.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

const EDITOR_MODE_OPTIONS = [
  { mode: "edit", label: "Edit" },
  { mode: "split", label: "Split" },
  { mode: "preview", label: "Preview" },
] satisfies readonly { mode: EditorMode; label: string }[];

type NoteWorkspaceProps = {
  project: NoteProject;
  selectedId: DocumentId | null;
  selectedDocument: NoteDocument | undefined;
  projectControl: ReactNode;
  sidebarFooter: ReactNode;
  mainContent?: ReactNode;
  focusTitleDocumentId?: DocumentId | null;
  onTitleFocusHandled: () => void;
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
  focusTitleDocumentId,
  onTitleFocusHandled,
  onCreateDocument,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
}: NoteWorkspaceProps) {
  const summaries = project.listDocuments();

  const sidebar = (
    <div className="sidebar-layout">
      <div className="sidebar-content">
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
            focusTitle={focusTitleDocumentId === selectedDocument.id}
            onTitleFocusHandled={onTitleFocusHandled}
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
  focusTitle: boolean;
  onTitleFocusHandled: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
};

function DocumentPane({
  document,
  focusTitle,
  onTitleFocusHandled,
  onRename,
  onDelete,
}: DocumentPaneProps) {
  const noteMenuRef = useRef<HTMLDetailsElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<EditorMode>(readEditorModePreference);
  useDismissibleDetails(noteMenuRef);

  useEffect(() => {
    if (!focusTitle) return;
    const input = titleRef.current;
    if (!input) return;

    input.focus();
    input.select();
    onTitleFocusHandled();
  }, [document.id, focusTitle, onTitleFocusHandled]);

  function deleteNote(): void {
    noteMenuRef.current?.removeAttribute("open");
    onDelete();
  }

  return (
    <article className="document-pane">
      <header className="document-header">
        <input
          ref={titleRef}
          className="title-input"
          value={document.title}
          placeholder="Untitled"
          onChange={(event) => onRename(event.target.value)}
          aria-label="Note title"
        />

        <div className="document-header-actions">
          <details className="note-menu" ref={noteMenuRef}>
            <summary className="note-menu-trigger" aria-label="Note actions">
              •••
            </summary>
            <div className="note-menu-popover">
              <button
                className="danger-menu-item"
                type="button"
                onClick={deleteNote}
              >
                Delete note
              </button>
            </div>
          </details>
        </div>
      </header>

      <NoteProperties document={document} />

      <div className="editor-mode-row">
        <div className="editor-mode-switch" aria-label="Note view">
          {EDITOR_MODE_OPTIONS.map((option) => (
            <button
              className={mode === option.mode ? "active" : undefined}
              key={option.mode}
              type="button"
              aria-pressed={mode === option.mode}
              onClick={() => {
                setMode(option.mode);
                writeEditorModePreference(option.mode);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <EditorModeView document={document} mode={mode} />
    </article>
  );
}
