import { useEffect, useRef, useState, type ReactNode } from "react";

import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { CheckpointId, DocumentId, ProjectId } from "@floe-note/domain";

import { AppShell } from "./AppShell.js";
import { EditorModeView } from "./EditorModeView.js";
import {
  EditHistoryPanel,
  HistoricalVersionView,
} from "./EditHistory.js";
import { GlobalSearch } from "./GlobalSearch.js";
import { GlobalSearchCache } from "./global-search.js";
import { Modal } from "./Modal.js";
import {
  readEditorModePreference,
  writeEditorModePreference,
  type EditorMode,
} from "./editor-mode-preference.js";
import { NoteProperties } from "./NoteProperties.js";
import {
  readNoteRecency,
  recordNoteOpened,
} from "./note-recency.js";
import {
  DEFAULT_TAG_FILTER_MODE,
  deriveVisibleNotes,
  readNoteSortPreference,
  resolveSelectedTags,
  writeNoteSortPreference,
  type TagFilterMode,
} from "./sidebar-navigation.js";
import { SidebarNavigationToolbar } from "./SidebarNavigationToolbar.js";
import { SidebarNoteRow } from "./SidebarNoteRow.js";
import { SidebarTrashNoteRow } from "./SidebarTrashNoteRow.js";
import {
  PermanentDeleteConfirmation,
  TrashView,
} from "./TrashView.js";
import { useAutomaticEditHistory } from "./useAutomaticEditHistory.js";
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
  workspaceProjectControl: ReactNode;
  selectedProjectId: ProjectId | null;
  sidebarFooter: ReactNode;
  mainContent?: ReactNode;
  trashActive: boolean;
  trashDocumentId?: DocumentId | null;
  focusTitleDocumentId?: DocumentId | null;
  onTitleFocusHandled: () => void;
  onCreateDocument: () => void;
  onSelectDocument: (documentId: DocumentId) => void;
  onRenameDocument: (title: string) => void;
  onDeleteDocument: (documentId: DocumentId) => void;
  onMoveDocument: (documentId: DocumentId, projectId: ProjectId) => void;
  onRestoreDocument: (documentId: DocumentId) => void;
  onPurgeDocument: (documentId: DocumentId) => void;
  onOpenTrash: () => void;
  onSelectTrashDocument?: (documentId: DocumentId | null) => void;
};

export function NoteWorkspace({
  project,
  selectedId,
  selectedDocument,
  projectControl,
  workspaceProjectControl,
  selectedProjectId,
  sidebarFooter,
  mainContent,
  trashActive,
  trashDocumentId,
  focusTitleDocumentId,
  onTitleFocusHandled,
  onCreateDocument,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
  onMoveDocument,
  onRestoreDocument,
  onPurgeDocument,
  onOpenTrash,
  onSelectTrashDocument,
}: NoteWorkspaceProps) {
  const normalizedTrashDocumentId = trashDocumentId ?? null;
  const summaries = project.listDocuments();
  const [, setNavigationRevision] = useState(0);
  const [, setRecencyRevision] = useState(0);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const searchCacheHolderRef = useRef<{
    projectId: string;
    cache: GlobalSearchCache;
  } | null>(null);

  if (searchCacheHolderRef.current?.projectId !== project.id) {
    const cache = new GlobalSearchCache();
    cache.syncProject(project);
    searchCacheHolderRef.current = {
      projectId: project.id,
      cache,
    };
  }

  const searchCache = searchCacheHolderRef.current!.cache;
  searchCache.syncProject(project);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(readNoteSortPreference);
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([]);
  const [tagFilterMode, setTagFilterMode] = useState<TagFilterMode>(
    DEFAULT_TAG_FILTER_MODE,
  );
  const [trashExpanded, setTrashExpanded] = useState(false);
  const [selectedTrashDocumentId, setSelectedTrashDocumentId] =
    useState<DocumentId | null>(normalizedTrashDocumentId);
  const [pendingPurgeDocumentId, setPendingPurgeDocumentId] =
    useState<DocumentId | null>(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [movingDocumentId, setMovingDocumentId] =
    useState<DocumentId | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTrashDocumentId(normalizedTrashDocumentId);
    if (normalizedTrashDocumentId !== null) setTrashExpanded(true);
  }, [normalizedTrashDocumentId]);

  useEffect(() => {
    setGlobalSearchOpen(false);
    setSearchOpen(false);
    setQuery("");
    setSelectedTags([]);
    setTagFilterMode(DEFAULT_TAG_FILTER_MODE);
    setTrashExpanded(false);
    setSelectedTrashDocumentId(null);
    setPendingPurgeDocumentId(null);
    setMovingDocumentId(null);
  }, [project.id]);

  const navigationDocumentIds = project
    .getAllDocuments()
    .map((document) => document.id)
    .join("\u0000");

  useEffect(
    () =>
      project.subscribe(() => {
        setNavigationRevision((value) => value + 1);
      }),
    [project],
  );

  useEffect(() => {
    const stopSubscriptions = project
      .getAllDocuments()
      .map((document) =>
        document.subscribe(() => {
          if (project.getDocument(document.id)) {
            const projectId = project.getDocumentProjectId(document.id);
            if (projectId) searchCache.updateDocument(document, projectId);
          } else {
            searchCache.removeDocument(document.id);
          }
          setNavigationRevision((value) => value + 1);
        }),
      );

    return () => {
      stopSubscriptions.forEach((stop) => stop());
    };
  }, [project, navigationDocumentIds, searchCache]);

  useEffect(() => {
    if (trashActive || selectedId === null) return;

    recordNoteOpened(project.id, selectedId);
    setRecencyRevision((value) => value + 1);
  }, [project.id, selectedId, trashActive]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "k" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const deletedSummaries = project.listDeletedDocuments();
  const selectedTrashDocument =
    selectedTrashDocumentId === null
      ? undefined
      : project.getDeletedDocument(selectedTrashDocumentId);
  const pendingPurgeDocument =
    pendingPurgeDocumentId === null
      ? undefined
      : project.getDeletedDocument(pendingPurgeDocumentId);
  const moveDestinations = movingDocumentId
    ? project.listProjects().filter(
        (item) =>
          item.status === "active" &&
          item.id !== project.getDocumentProjectId(movingDocumentId),
      )
    : [];

  useEffect(() => {
    if (
      selectedTrashDocumentId !== null &&
      selectedTrashDocument === undefined
    ) {
      setSelectedTrashDocumentId(null);
    }
  }, [selectedTrashDocument, selectedTrashDocumentId]);

  useEffect(() => {
    if (
      pendingPurgeDocumentId !== null &&
      pendingPurgeDocument === undefined
    ) {
      setPendingPurgeDocumentId(null);
    }
  }, [pendingPurgeDocument, pendingPurgeDocumentId]);

  const navigationNotes = summaries.flatMap((summary) => {
    const document = project.getDocument(summary.id);
    return document
      ? [
          {
            id: document.id,
            title: document.title,
            tags: document.tags,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
          },
        ]
      : [];
  });
  const scopedNotes = navigationNotes.filter(
    (note) =>
      selectedProjectId !== null &&
      project.getDocumentProjectId(note.id) === selectedProjectId,
  );
  const projectTags = selectedProjectId
    ? project.listProjectTags(selectedProjectId)
    : [];

  const visibleNotes = deriveVisibleNotes(
    scopedNotes,
    query,
    sort,
    selectedTags,
    tagFilterMode,
  );

  useEffect(() => {
    const resolved = resolveSelectedTags(selectedTags, projectTags);
    const changed =
      resolved.length !== selectedTags.length ||
      resolved.some((tag, index) => tag !== selectedTags[index]);
    if (changed) setSelectedTags(resolved);
  }, [projectTags, selectedTags]);

  useEffect(() => {
    setSelectedTags([]);
  }, [selectedProjectId]);

  const sidebar = (
    <div
      className="sidebar-layout"
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("[data-settings-entry]")) {
          setMobileNavigationOpen(false);
        }
      }}
    >
      <div className="sidebar-content">
        <header className="brand-row">
          <div className="workspace-context">{projectControl}</div>
          <button
            className="global-search-trigger"
            type="button"
            aria-label="Search all notes"
            title="Search all notes (Ctrl/Cmd + K)"
            onClick={() => setGlobalSearchOpen(true)}
          >
            <GlobalSearchIcon />
          </button>
        </header>

        {workspaceProjectControl}

        <p className="sidebar-section-label">Notes</p>

        <SidebarNavigationToolbar
          query={query}
          searchOpen={searchOpen}
          sort={sort}
          tags={projectTags}
          selectedTags={selectedTags}
          tagFilterMode={tagFilterMode}
          getTagColor={(tag) => project.resolveTagColor(selectedProjectId!, tag)}
          onQueryChange={setQuery}
          onSearchOpenChange={setSearchOpen}
          onSortChange={(preference) => {
            setSort(preference);
            writeNoteSortPreference(preference);
          }}
          onSelectedTagsChange={setSelectedTags}
          onTagFilterModeChange={setTagFilterMode}
          onCreateDocument={() => {
            onCreateDocument();
            setMobileNavigationOpen(false);
          }}
          canCreateDocument={selectedProjectId !== null}
        />

        <nav className="note-list" aria-label="Notes">
          {visibleNotes.length > 0 ? (
            visibleNotes.map((note) => (
              <SidebarNoteRow
                key={note.id}
                id={note.id}
                title={note.title}
                tags={note.tags}
                getTagColor={(tag) => project.resolveTagColor(selectedProjectId!, tag)}
                selected={!trashActive && note.id === selectedId}
                onSelect={(documentId) => {
                  setSelectedTrashDocumentId(null);
                  onSelectDocument(documentId);
                  setMobileNavigationOpen(false);
                }}
                onDelete={onDeleteDocument}
                onMove={(documentId) => {
                  setMovingDocumentId(documentId);
                  setMoveError(null);
                }}
              />
            ))
          ) : query.trim() || selectedTags.length > 0 ? (
            <p className="note-filter-empty">No matching notes</p>
          ) : null}
        </nav>

        <div className="sidebar-trash-section">
          <button
            className={
              trashActive && selectedTrashDocumentId === null
                ? "sidebar-trash-entry selected"
                : "sidebar-trash-entry"
            }
            type="button"
            aria-expanded={trashExpanded}
            aria-current={
              trashActive && selectedTrashDocumentId === null
                ? "page"
                : undefined
            }
            onClick={() => {
              setSelectedTrashDocumentId(null);
              onSelectTrashDocument?.(null);
              setTrashExpanded((expanded) => !expanded);
              onOpenTrash();
              setMobileNavigationOpen(false);
            }}
          >
            <span
              className={trashExpanded ? "trash-chevron expanded" : "trash-chevron"}
              aria-hidden="true"
            >
              <ChevronIcon />
            </span>
            <TrashIcon />
            <span>Trash</span>
          </button>

          {trashExpanded && deletedSummaries.length > 0 ? (
            <div className="sidebar-trash-list" aria-label="Deleted notes">
              {deletedSummaries.map((summary) => (
                <SidebarTrashNoteRow
                  key={summary.id}
                  id={summary.id}
                  title={summary.title}
                  selected={
                    trashActive &&
                    selectedTrashDocumentId === summary.id
                  }
                  onSelect={(documentId) => {
                    setSelectedTrashDocumentId(documentId);
                    onSelectTrashDocument?.(documentId);
                    setMobileNavigationOpen(false);
                  }}
                  onRestore={(documentId) => {
                    onRestoreDocument(documentId);
                    setMobileNavigationOpen(false);
                  }}
                  onRequestPermanentDelete={(documentId) => {
                    setPendingPurgeDocumentId(documentId);
                    setMobileNavigationOpen(false);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <footer
        className="sidebar-footer"
        onClickCapture={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(".footer-action, .sync-manage-devices")
          ) {
            setMobileNavigationOpen(false);
          }
        }}
      >
        {sidebarFooter}
      </footer>
    </div>
  );

  const mobileTitle = mainContent
    ? "Floe Note"
    : trashActive
      ? selectedTrashDocument?.title || "Trash"
      : selectedDocument?.title || "Floe Note";

  return (
    <>
      <AppShell
      sidebar={sidebar}
      mobileNavigationOpen={mobileNavigationOpen}
      mobileTitle={mobileTitle}
      onMobileNavigationOpenChange={setMobileNavigationOpen}
    >
      {mainContent ??
        (trashActive ? (
          <TrashView
            project={project}
            selectedDocumentId={selectedTrashDocumentId}
            onSelectDocument={(documentId) => {
              setSelectedTrashDocumentId(documentId);
              onSelectTrashDocument?.(documentId);
              setTrashExpanded(true);
              setMobileNavigationOpen(false);
            }}
            onRestoreDocument={onRestoreDocument}
            onRequestPermanentDelete={setPendingPurgeDocumentId}
          />
        ) : selectedDocument ? (
          <DocumentPane
            project={project}
            document={selectedDocument}
            availableTags={projectTags}
            focusTitle={focusTitleDocumentId === selectedDocument.id}
            onTitleFocusHandled={onTitleFocusHandled}
            onRename={onRenameDocument}
            onDelete={onDeleteDocument}
            onMove={(documentId) => {
              setMovingDocumentId(documentId);
              setMoveError(null);
            }}
          />
        ) : (
          <div className="workspace-empty-state">
            <div className="empty-floe" aria-hidden="true">
              ◆
            </div>
            <h1>{selectedProjectId ? "No notes yet" : "No active Projects"}</h1>
            <p>
              {selectedProjectId
                ? `Create a note in ${project.getProject(selectedProjectId)?.name ?? "this Project"}.`
                : "Create a Project or reopen an archived Project to start writing."}
            </p>
            {selectedProjectId ? (
              <button type="button" onClick={onCreateDocument}>
                Create your first note
              </button>
            ) : null}
          </div>
        ))}
      </AppShell>

      {globalSearchOpen ? (
        <GlobalSearch
          cache={searchCache}
          lastOpenedAt={readNoteRecency(project.id)}
          getTagColor={(projectId, tag) => project.resolveTagColor(projectId, tag)}
          onClose={() => setGlobalSearchOpen(false)}
          onSelect={(documentId) => {
            recordNoteOpened(project.id, documentId);
            setRecencyRevision((value) => value + 1);
            setSelectedTrashDocumentId(null);
            onSelectDocument(documentId);
            setMobileNavigationOpen(false);
          }}
        />
      ) : null}

      {pendingPurgeDocument ? (
        <PermanentDeleteConfirmation
          onCancel={() => setPendingPurgeDocumentId(null)}
          onConfirm={() => {
            onPurgeDocument(pendingPurgeDocument.id);
            setPendingPurgeDocumentId(null);
          }}
        />
      ) : null}

      {movingDocumentId ? (
        <Modal labelledBy="move-note-title" onClose={() => setMovingDocumentId(null)}>
          <h2 id="move-note-title">Move note…</h2>
          <p>Choose an active Project.</p>
          <div className="move-project-list">
            {moveDestinations.length === 0 ? (
              <p>No other active Projects.</p>
            ) : null}
            {moveDestinations.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  try {
                    onMoveDocument(movingDocumentId, item.id);
                    setMovingDocumentId(null);
                  } catch (caught) {
                    setMoveError(caught instanceof Error ? caught.message : "Could not move note");
                  }
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
          {moveError ? <p role="alert">{moveError}</p> : null}
          <div className="dialog-actions">
            <button className="dialog-secondary-button" type="button" onClick={() => setMovingDocumentId(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

type DocumentPaneProps = {
  project: NoteProject;
  document: NoteDocument;
  availableTags: readonly string[];
  focusTitle: boolean;
  onTitleFocusHandled: () => void;
  onRename: (title: string) => void;
  onDelete: (documentId: DocumentId) => void;
  onMove: (documentId: DocumentId) => void;
};

function DocumentPane({
  project,
  document,
  availableTags,
  focusTitle,
  onTitleFocusHandled,
  onRename,
  onDelete,
  onMove,
}: DocumentPaneProps) {
  const noteMenuRef = useRef<HTMLDetailsElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>(readEditorModePreference);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedCheckpointId, setSelectedCheckpointId] =
    useState<CheckpointId | null>(null);
  const [, setHistoryRevision] = useState(0);

  useDismissibleDetails(noteMenuRef);
  useAutomaticEditHistory(project, document);

  useEffect(
    () =>
      project.subscribe(() => {
        setHistoryRevision((value) => value + 1);
      }),
    [project],
  );

  useEffect(() => {
    setHistoryOpen(false);
    setSelectedCheckpointId(null);
  }, [document.id]);

  useEffect(() => {
    const input = titleRef.current;
    if (!input || mode === "split") return;

    // Split mode constrains the title to a compact one-line header. Recompute
    // the normal textarea height whenever we leave Split so that a height
    // measured under the compact CSS cannot leak into Edit/Preview.
    resizeTitleInput(input);
  }, [document.id, document.title, mode]);

  useEffect(() => {
    const input = titleRef.current;
    if (!input) return;

    const resize = () => resizeTitleInput(input);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [document.id]);

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
    onDelete(document.id);
  }

  const checkpoints = project.listEditHistoryCheckpoints(document.id);
  const selectedCheckpoint =
    selectedCheckpointId === null
      ? null
      : project.getEditHistoryCheckpoint(selectedCheckpointId);

  let historicalDocument: NoteDocument | null = null;
  if (
    selectedCheckpoint &&
    selectedCheckpoint.documentId === document.id
  ) {
    try {
      historicalDocument = project.createHistoricalDocument(
        selectedCheckpoint.id,
      );
    } catch {
      historicalDocument = null;
    }
  }

  function openHistory(): void {
    noteMenuRef.current?.removeAttribute("open");
    setHistoryOpen(true);
  }

  function restoreHistoricalVersion(): void {
    if (!selectedCheckpoint) return;

    project.restoreEditHistoryCheckpoint(selectedCheckpoint.id);
    setSelectedCheckpointId(null);
  }

  return (
    <article
      className={
        historyOpen
          ? "document-pane document-pane-with-history"
          : "document-pane"
      }
    >
      <div className="document-history-content">
        <div
          className={
            historicalDocument
              ? "document-current-view document-current-view-hidden"
              : "document-current-view"
          }
          data-editor-mode={mode}
          aria-hidden={historicalDocument ? "true" : undefined}
        >
          <header className="document-header">
            <textarea
              ref={titleRef}
              className="title-input"
              rows={1}
              value={document.title}
              placeholder="Untitled"
              aria-label="Note title"
              onChange={(event) => {
                const title = event.currentTarget.value.replace(/[\r\n]+/g, " ");
                onRename(title);
                window.requestAnimationFrame(() => {
                  if (titleRef.current) resizeTitleInput(titleRef.current);
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />

            <div className="document-header-actions">
              <details className="note-menu" ref={noteMenuRef}>
                <summary className="note-menu-trigger" aria-label="Note actions">
                  •••
                </summary>
                <div className="note-menu-popover">
                  <button
                    className="note-menu-item"
                    type="button"
                    onClick={openHistory}
                  >
                    History
                  </button>
                  <button
                    className="note-menu-item"
                    type="button"
                    onClick={() => {
                      noteMenuRef.current?.removeAttribute("open");
                      onMove(document.id);
                    }}
                  >
                    Move note…
                  </button>
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

          <NoteProperties
            document={document}
            compact={mode === "split"}
            availableTags={availableTags}
            getTagColor={(tag) =>
              project.resolveTagColor(project.getDocumentProjectId(document.id)!, tag)
            }
            onTagColorChange={(tag, color) =>
              project.setTagColor(project.getDocumentProjectId(document.id)!, tag, color)
            }
            onTagRename={(oldTag, newTag) =>
              project.renameTag(project.getDocumentProjectId(document.id)!, oldTag, newTag)
            }
            trailingControl={
              <EditorModeSwitcher
                mode={mode}
                onModeChange={(nextMode) => {
                  setMode(nextMode);
                  writeEditorModePreference(nextMode);
                }}
              />
            }
          />

          <EditorModeView document={document} mode={mode} />
        </div>

        {selectedCheckpoint && historicalDocument ? (
          <HistoricalVersionView
            checkpoint={selectedCheckpoint}
            document={historicalDocument}
            onBackToCurrent={() => setSelectedCheckpointId(null)}
            onRestore={restoreHistoricalVersion}
          />
        ) : selectedCheckpointId !== null ? (
          <div className="historical-version-unavailable">
            <p>This historical version is not available on this device yet.</p>
            <button type="button" onClick={() => setSelectedCheckpointId(null)}>
              Back to current
            </button>
          </div>
        ) : null}
      </div>

      {historyOpen ? (
        <EditHistoryPanel
          checkpoints={checkpoints}
          selectedCheckpointId={selectedCheckpointId}
          onSelectCheckpoint={setSelectedCheckpointId}
          onSelectCurrent={() => setSelectedCheckpointId(null)}
          onClose={() => {
            setSelectedCheckpointId(null);
            setHistoryOpen(false);
          }}
        />
      ) : null}
    </article>
  );
}


type EditorModeSwitcherProps = {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
};

export function EditorModeSwitcher({
  mode,
  onModeChange,
}: EditorModeSwitcherProps) {
  return (
    <div className="editor-mode-switch" aria-label="Note view">
      {EDITOR_MODE_OPTIONS.map((option) => (
        <button
          className={mode === option.mode ? "active" : undefined}
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          onClick={() => onModeChange(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function resizeTitleInput(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 2}px`;
}

function GlobalSearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.5 12.5 4 4" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7 5 5 5-5 5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.5 6h11M8 3.5h4M6 6l.7 10h6.6L14 6" />
      <path d="M8.5 8.5v5M11.5 8.5v5" />
    </svg>
  );
}
