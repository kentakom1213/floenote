import { useEffect, useRef, useState } from "react";

import type { NoteProject } from "@floe-note/document";
import { parseWorkspaceId } from "@floe-note/domain";
import { DexieProjectStorage } from "@floe-note/storage";
import { ProjectSyncEngine } from "@floe-note/sync";
import {
  WebRtcTransport,
  type WebRtcStatus,
} from "@floe-note/transport/webrtc";

import { createConsoleDebugLogger } from "./debug.js";
import { JoinedProjectEditor } from "./JoinedProjectEditor.js";

const INITIAL_STATUS: WebRtcStatus = {
  connectionState: "new",
  iceConnectionState: "new",
  iceGatheringState: "new",
  dataChannelState: "none",
  gatheredCandidateCount: 0,
  warning: null,
  error: null,
};

type WebRtcJoinPageProps = {
  storage: DexieProjectStorage;
};

export function WebRtcJoinPage({ storage }: WebRtcJoinPageProps) {
  const [projectIdInput, setWorkspaceIdInput] = useState("");
  const [offer, setOffer] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<WebRtcStatus>(INITIAL_STATUS);
  const [project, setProject] = useState<NoteProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setRevision] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  async function joinProject() {
    cleanupRef.current?.();
    cleanupRef.current = null;

    setBusy(true);
    setError(null);
    setAnswer("");
    setProject(null);
    setStatus(INITIAL_STATUS);

    const transportHolder: { transport: WebRtcTransport | null } = {
      transport: null,
    };

    try {
      const projectId = parseWorkspaceId(projectIdInput.trim());
      const transport = new WebRtcTransport(
        projectId,
        undefined,
        createConsoleDebugLogger("join-webrtc"),
      );
      transportHolder.transport = transport;

      const stopStatus = transport.onStatusChange(setStatus);
      const localAnswer = await transport.acceptOffer(offer.trim());

      const joinedProject = await storage.initializeJoinedProject(projectId);
      const stopPersistence = storage.watchProject(joinedProject);
      const stopProject = joinedProject.subscribe(() => {
        setRevision((value) => value + 1);
      });
      const syncEngine = new ProjectSyncEngine(joinedProject, transport, {
        debugLogger: createConsoleDebugLogger("join-sync"),
      });
      syncEngine.start();

      cleanupRef.current = () => {
        stopProject();
        stopPersistence();
        stopStatus();
        syncEngine.stop();
      };

      setProject(joinedProject);
      setAnswer(localAnswer);
    } catch (caught: unknown) {
      transportHolder.transport?.close();
      setError(
        caught instanceof Error ? caught.message : "Failed to join Project",
      );
    } finally {
      setBusy(false);
    }
  }

  const summaries = project?.listDocuments() ?? [];

  return (
    <main className="join-page">
      <section className="join-card">
        <p className="eyebrow">Manual Project join</p>
        <h1>Join an existing Floe Note Project</h1>
        <p className="join-description">
          This is a Step 4A debug flow. Paste the Project ID and WebRTC offer
          from an existing browser. The selected Project becomes this
          browser&apos;s default local Project; previous local Project data is
          retained but detached from the default slot.
        </p>

        <label className="webrtc-field">
          <span>Project ID</span>
          <input
            value={projectIdInput}
            onChange={(event) => setWorkspaceIdInput(event.target.value)}
            placeholder="UUIDv7 WorkspaceId"
          />
        </label>

        <label className="webrtc-field">
          <span>Remote offer</span>
          <textarea
            value={offer}
            onChange={(event) => setOffer(event.target.value)}
            rows={8}
            placeholder="Paste offer JSON here"
          />
        </label>

        <button
          className="join-primary-button"
          type="button"
          onClick={() => void joinProject()}
          disabled={
            busy || projectIdInput.trim() === "" || offer.trim() === ""
          }
        >
          {busy ? "Preparing join…" : "Join Project + create answer"}
        </button>

        <p className="webrtc-status">
          Peer connection: <strong>{status.connectionState}</strong>
        </p>
        <p className="webrtc-status">
          ICE connection: <strong>{status.iceConnectionState}</strong>
        </p>
        <p className="webrtc-status">
          ICE gathering: <strong>{status.iceGatheringState}</strong>
        </p>
        <p className="webrtc-status">
          Candidates: <strong>{status.gatheredCandidateCount}</strong>
        </p>
        <p className="webrtc-status">
          Data channel: <strong>{status.dataChannelState}</strong>
        </p>

        {answer ? (
          <label className="webrtc-field">
            <span>Local answer</span>
            <textarea readOnly value={answer} rows={8} />
          </label>
        ) : null}

        {status.warning ? (
          <p className="webrtc-warning">{status.warning}</p>
        ) : null}
        {status.error ? <p className="webrtc-error">{status.error}</p> : null}
        {error ? <p className="webrtc-error">{error}</p> : null}

        {project ? (
          <section className="join-result">
            <p>
              Received notes: <strong>{summaries.length}</strong>
            </p>
            <p className="join-live-hint">
              Keep this page open while testing live WebRTC sync. The editor
              below uses the same joined Project and connection, so edits here
              should propagate back to the existing browser immediately.
            </p>
            <JoinedProjectEditor project={project} />
          </section>
        ) : null}
      </section>
    </main>
  );
}
