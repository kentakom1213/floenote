import { useEffect, useState } from "react";

import { type NoteDocument, type NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";
import { DexieProjectStorage } from "@floe-note/storage";
import { ProjectSyncEngine } from "@floe-note/sync";
import { BroadcastChannelTransport } from "@floe-note/transport/broadcast-channel";
import { WebRtcTransport } from "@floe-note/transport/webrtc";

import { createConsoleDebugLogger } from "./debug.js";
import { MarkdownEditor } from "./MarkdownEditor.js";
import { WebRtcDebugPanel } from "./WebRtcDebugPanel.js";
import { WebRtcJoinPage } from "./WebRtcJoinPage.js";

const projectStorage = new DexieProjectStorage();
const searchParams = new URLSearchParams(window.location.search);
const useManualWebRtc = searchParams.get("transport") === "webrtc";
const useManualWebRtcJoin = searchParams.get("join") === "webrtc";

type OpenedProject = {
  project: NoteProject;
  isNew: boolean;
};

export function App() {
  if (useManualWebRtcJoin) {
    return <WebRtcJoinPage storage={projectStorage} />;
  }

  return <NoteApp />;
}

function NoteApp() {
  const [openedProject, setOpenedProject] = useState<OpenedProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<DocumentId | null>(null);
  const [webRtcTransport, setWebRtcTransport] =
    useState<WebRtcTransport | null>(null);

  const project = openedProject?.project ?? null;

  useEffect(() => {
    let cancelled = false;

    void projectStorage
      .openOrCreateProject()
      .then((result) => {
        if (!cancelled) setOpenedProject(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Failed to load project",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!project) return;

    const unsubscribeUi = project.subscribe(() =>
      setRevision((value) => value + 1),
    );
    const stopPersistence = projectStorage.watchProject(project);

    return () => {
      unsubscribeUi();
      stopPersistence();
    };
  }, [project]);

  useEffect(() => {
    if (!project) return;

    const transport = useManualWebRtc
      ? new WebRtcTransport(
          project.id,
          undefined,
          createConsoleDebugLogger("webrtc"),
        )
      : new BroadcastChannelTransport(project.id);

    if (transport instanceof WebRtcTransport) {
      setWebRtcTransport(transport);
    } else {
      setWebRtcTransport(null);
    }

    const syncEngine = new ProjectSyncEngine(project, transport, {
      debugLogger: useManualWebRtc
        ? createConsoleDebugLogger("sync")
        : undefined,
    });
    syncEngine.start();

    return () => syncEngine.stop();
  }, [project]);

  useEffect(() => {
    if (!openedProject) return;

    const { project: loadedProject, isNew } = openedProject;
    const summaries = loadedProject.listDocuments();

    if (isNew) {
      const document = loadedProject.createDocument("Welcome to Floe Note");
      setSelectedId(document.id);
      return;
    }

    setSelectedId(summaries[0]?.id ?? null);
  }, [openedProject]);

  if (loadError) {
    return (
      <main className="empty-state">
        <p>Could not open local storage.</p>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="empty-state">
        <p>Loading local notes…</p>
      </main>
    );
  }

  const activeProject = project;
  const summaries = activeProject.listDocuments();
  const selectedDocument = selectedId
    ? activeProject.getDocument(selectedId)
    : undefined;

  function createDocument() {
    const document = activeProject.createDocument();
    setSelectedId(document.id);
  }

  function deleteSelectedDocument() {
    if (!selectedId) return;

    activeProject.deleteDocument(selectedId);
    const next = activeProject.listDocuments()[0];
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

        {webRtcTransport ? (
          <WebRtcDebugPanel
            projectId={activeProject.id}
            transport={webRtcTransport}
          />
        ) : null}
      </aside>

      <section className="workspace">
        {selectedDocument ? (
          <DocumentPane
            document={selectedDocument}
            onRename={(title) =>
              activeProject.renameDocument(selectedDocument.id, title)
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
