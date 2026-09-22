import { useEffect, useState } from "react";

import {
  createPairingSecret,
  createSessionId,
  InvitationClient,
  WebRtcSignalingSession,
  type InviteId,
  type PairingSecret,
  type SessionId,
  type SignalingConnectionState,
} from "@floe-note/coordinator-client";
import { type NoteDocument, type NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";
import { DexieProjectStorage } from "@floe-note/storage";
import { ProjectSyncEngine } from "@floe-note/sync";
import { BroadcastChannelTransport } from "@floe-note/transport/broadcast-channel";
import { WebRtcTransport } from "@floe-note/transport/webrtc";

import { createConsoleDebugLogger } from "./debug.js";
import { InvitationHostPanel } from "./InvitationHostPanel.js";
import { InvitationJoinPage } from "./InvitationJoinPage.js";
import { MarkdownEditor } from "./MarkdownEditor.js";
import { SignaledJoinPage } from "./SignaledJoinPage.js";
import { SignalingHostPanel } from "./SignalingHostPanel.js";
import { WebRtcDebugPanel } from "./WebRtcDebugPanel.js";
import { WebRtcJoinPage } from "./WebRtcJoinPage.js";

const projectStorage = new DexieProjectStorage();
const searchParams = new URLSearchParams(window.location.search);
const useManualWebRtc = searchParams.get("transport") === "webrtc";
const useSignaledWebRtc = searchParams.get("transport") === "signal";
const useInvitationWebRtc = searchParams.get("transport") === "invite";
const useManualWebRtcJoin = searchParams.get("join") === "webrtc";
const useSignaledWebRtcJoin = searchParams.get("join") === "signal";
const invitationPathMatch = /^\/join\/v1\/([0-9a-f]{32})$/i.exec(
  window.location.pathname,
);
const pairingSecretFromFragment = new URLSearchParams(
  window.location.hash.slice(1),
).get("s");
const coordinatorBaseUrl =
  import.meta.env.VITE_COORDINATOR_URL ?? "http://localhost:8787";

type OpenedProject = {
  project: NoteProject;
  isNew: boolean;
};

type InvitationHostState = {
  inviteId: InviteId;
  pairingSecret: PairingSecret;
  sessionId: SessionId;
  expiresAt: number;
};

export function App() {
  const invitationId = invitationPathMatch?.[1];
  if (invitationId) {
    return (
      <InvitationJoinPage
        storage={projectStorage}
        coordinatorBaseUrl={coordinatorBaseUrl}
        inviteId={invitationId}
        pairingSecret={pairingSecretFromFragment}
      />
    );
  }

  if (useManualWebRtcJoin) {
    return <WebRtcJoinPage storage={projectStorage} />;
  }

  if (useSignaledWebRtcJoin) {
    return (
      <SignaledJoinPage
        storage={projectStorage}
        coordinatorBaseUrl={coordinatorBaseUrl}
        projectId={searchParams.get("project")}
        sessionId={searchParams.get("session")}
      />
    );
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
  const [signalingState, setSignalingState] =
    useState<SignalingConnectionState>("idle");
  const [signalSessionId] = useState(() => createSessionId());
  const [invitationHost, setInvitationHost] =
    useState<InvitationHostState | null>(null);
  const [coordinationError, setCoordinationError] = useState<string | null>(
    null,
  );

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

    setCoordinationError(null);

    if (useInvitationWebRtc) {
      let disposed = false;
      let cleanup: (() => void) | null = null;
      const invitationClient = new InvitationClient(coordinatorBaseUrl);

      void (async () => {
        try {
          const pairingSecret = createPairingSecret();
          const invitation = await invitationClient.createInvite(project.id);
          if (disposed) return;

          const transport = new WebRtcTransport(
            project.id,
            undefined,
            createConsoleDebugLogger("invite-host-webrtc"),
          );
          setWebRtcTransport(transport);

          const syncEngine = new ProjectSyncEngine(project, transport, {
            debugLogger: createConsoleDebugLogger("invite-host-sync"),
          });
          syncEngine.start();

          const signaling = new WebRtcSignalingSession({
            role: "host",
            coordinatorBaseUrl,
            projectId: project.id,
            sessionId: invitation.sessionId,
            transport,
            debugLogger: createConsoleDebugLogger("invite-host-signal"),
          });
          const stopSignalingState =
            signaling.onConnectionStateChange(setSignalingState);
          signaling.start();

          setInvitationHost({
            inviteId: invitation.inviteId,
            pairingSecret,
            sessionId: invitation.sessionId,
            expiresAt: invitation.expiresAt,
          });

          cleanup = () => {
            stopSignalingState();
            signaling.stop();
            syncEngine.stop();
          };
        } catch (caught: unknown) {
          if (!disposed) {
            setCoordinationError(
              caught instanceof Error
                ? caught.message
                : "Failed to create invitation",
            );
          }
        }
      })();

      return () => {
        disposed = true;
        cleanup?.();
        setInvitationHost(null);
      };
    }

    if (useManualWebRtc || useSignaledWebRtc) {
      const transport = new WebRtcTransport(
        project.id,
        undefined,
        createConsoleDebugLogger(
          useSignaledWebRtc ? "signal-host-webrtc" : "webrtc",
        ),
      );
      setWebRtcTransport(transport);

      const syncEngine = new ProjectSyncEngine(project, transport, {
        debugLogger: createConsoleDebugLogger(
          useSignaledWebRtc ? "signal-host-sync" : "sync",
        ),
      });
      syncEngine.start();

      if (!useSignaledWebRtc) {
        return () => syncEngine.stop();
      }

      const signaling = new WebRtcSignalingSession({
        role: "host",
        coordinatorBaseUrl,
        projectId: project.id,
        sessionId: signalSessionId,
        transport,
        debugLogger: createConsoleDebugLogger("signal-host"),
      });
      const stopSignalingState =
        signaling.onConnectionStateChange(setSignalingState);
      signaling.start();

      return () => {
        stopSignalingState();
        signaling.stop();
        syncEngine.stop();
      };
    }

    setWebRtcTransport(null);
    setSignalingState("idle");

    const transport = new BroadcastChannelTransport(project.id);
    const syncEngine = new ProjectSyncEngine(project, transport);
    syncEngine.start();

    return () => syncEngine.stop();
  }, [project, signalSessionId]);

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

        {useInvitationWebRtc && invitationHost && webRtcTransport ? (
          <InvitationHostPanel
            inviteId={invitationHost.inviteId}
            pairingSecret={invitationHost.pairingSecret}
            expiresAt={invitationHost.expiresAt}
            transport={webRtcTransport}
            signalingState={signalingState}
            onCancel={() =>
              new InvitationClient(coordinatorBaseUrl).cancelInvite(
                invitationHost.inviteId,
              )
            }
          />
        ) : useInvitationWebRtc ? (
          <p className="webrtc-hint">Creating invitation…</p>
        ) : useSignaledWebRtc && webRtcTransport ? (
          <SignalingHostPanel
            projectId={activeProject.id}
            sessionId={signalSessionId}
            transport={webRtcTransport}
            signalingState={signalingState}
          />
        ) : webRtcTransport ? (
          <WebRtcDebugPanel
            projectId={activeProject.id}
            transport={webRtcTransport}
          />
        ) : null}

        {coordinationError ? (
          <p className="webrtc-error">{coordinationError}</p>
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
