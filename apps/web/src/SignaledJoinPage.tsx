import {
  parseSessionId,
  WebRtcSignalingSession,
  type SignalingConnectionState,
} from "@floe-note/coordinator-client";
import type { NoteProject } from "@floe-note/document";
import { parseWorkspaceId } from "@floe-note/domain";
import { DexieWorkspaceStorage } from "@floe-note/storage";
import { WorkspaceSyncEngine } from "@floe-note/sync";
import {
  WebRtcTransport,
  type WebRtcStatus,
} from "@floe-note/transport/webrtc";
import { useEffect, useState } from "react";

import { createConsoleDebugLogger } from "./debug.js";
import { JoinedProjectEditor } from "./JoinedProjectEditor.js";

const INITIAL_WEBRTC_STATUS: WebRtcStatus = {
  connectionState: "new",
  iceConnectionState: "new",
  iceGatheringState: "new",
  dataChannelState: "none",
  gatheredCandidateCount: 0,
  warning: null,
  error: null,
};

type SignaledJoinPageProps = {
  storage: DexieWorkspaceStorage;
  coordinatorBaseUrl: string;
  projectId: string | null;
  sessionId: string | null;
};

export function SignaledJoinPage({
  storage,
  coordinatorBaseUrl,
  projectId,
  sessionId,
}: SignaledJoinPageProps) {
  const [project, setProject] = useState<NoteProject | null>(null);
  const [webRtcStatus, setWebRtcStatus] =
    useState<WebRtcStatus>(INITIAL_WEBRTC_STATUS);
  const [signalingState, setSignalingState] =
    useState<SignalingConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (!projectId || !sessionId) {
      setError("Missing WorkspaceId or SessionId in the join URL.");
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      try {
        const parsedWorkspaceId = parseWorkspaceId(projectId);
        const parsedSessionId = parseSessionId(sessionId);
        const joinedProject =
          await storage.initializeJoinedWorkspace(parsedWorkspaceId);

        if (disposed) return;

        const transport = new WebRtcTransport(
          parsedWorkspaceId,
          undefined,
          createConsoleDebugLogger("signal-join-webrtc"),
        );
        const stopTransportStatus =
          transport.onStatusChange(setWebRtcStatus);
        const stopPersistence = storage.watchWorkspace(joinedProject);
        const stopProject = joinedProject.subscribe(() => {
          setRevision((value) => value + 1);
        });

        const syncEngine = new WorkspaceSyncEngine(joinedProject, transport, {
          debugLogger: createConsoleDebugLogger("signal-join-sync"),
        });
        syncEngine.start();

        const signaling = new WebRtcSignalingSession({
          role: "join",
          coordinatorBaseUrl,
          workspaceId: parsedWorkspaceId,
          sessionId: parsedSessionId,
          transport,
          debugLogger: createConsoleDebugLogger("signal-join"),
        });
        const stopSignalingState =
          signaling.onConnectionStateChange(setSignalingState);
        signaling.start();

        cleanup = () => {
          stopSignalingState();
          signaling.stop();
          stopProject();
          stopPersistence();
          stopTransportStatus();
          syncEngine.stop();
        };

        setProject(joinedProject);
      } catch (caught: unknown) {
        setError(
          caught instanceof Error ? caught.message : "Failed to join Project",
        );
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [coordinatorBaseUrl, projectId, sessionId, storage]);

  if (error) {
    return (
      <main className="empty-state">
        <p>Could not join Project.</p>
        <p>{error}</p>
      </main>
    );
  }

  return (
    <main className="join-page">
      <section className="join-card">
        <p className="eyebrow">Cloudflare signaling</p>
        <h1>Joining Floe Note Project</h1>

        <p className="webrtc-status">
          Signaling: <strong>{signalingState}</strong>
        </p>
        <p className="webrtc-status">
          Peer connection: <strong>{webRtcStatus.connectionState}</strong>
        </p>
        <p className="webrtc-status">
          ICE connection: <strong>{webRtcStatus.iceConnectionState}</strong>
        </p>
        <p className="webrtc-status">
          ICE gathering: <strong>{webRtcStatus.iceGatheringState}</strong>
        </p>
        <p className="webrtc-status">
          Data channel: <strong>{webRtcStatus.dataChannelState}</strong>
        </p>

        {webRtcStatus.warning ? (
          <p className="webrtc-warning">{webRtcStatus.warning}</p>
        ) : null}
        {webRtcStatus.error ? (
          <p className="webrtc-error">{webRtcStatus.error}</p>
        ) : null}

        {project ? (
          <section className="join-result">
            <p className="join-live-hint">
              Signaling and trickle ICE are automatic. This editor stays on
              the live WebRTC connection for Step 4B verification.
            </p>
            <JoinedProjectEditor project={project} />
          </section>
        ) : (
          <p className="join-live-hint">Preparing local Project…</p>
        )}
      </section>
    </main>
  );
}
