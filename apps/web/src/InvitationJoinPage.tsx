import {
  createClaimId,
  InvitationClient,
  parseInviteId,
  parsePairingSecret,
  WebRtcSignalingSession,
  type SignalingConnectionState,
} from "@floe-note/coordinator-client";
import type { NoteProject } from "@floe-note/document";
import { authenticatePairingChannel } from "@floe-note/pairing";
import { DexieProjectStorage } from "@floe-note/storage";
import { ProjectSyncEngine } from "@floe-note/sync";
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

type InvitationJoinPageProps = {
  storage: DexieProjectStorage;
  coordinatorBaseUrl: string;
  inviteId: string;
  pairingSecret: string | null;
};

export function InvitationJoinPage({
  storage,
  coordinatorBaseUrl,
  inviteId,
  pairingSecret,
}: InvitationJoinPageProps) {
  const [claimId] = useState(() => createClaimId());
  const [project, setProject] = useState<NoteProject | null>(null);
  const [webRtcStatus, setWebRtcStatus] =
    useState<WebRtcStatus>(INITIAL_WEBRTC_STATUS);
  const [signalingState, setSignalingState] =
    useState<SignalingConnectionState>("idle");
  const [claimState, setClaimState] = useState<
    "claiming" | "claimed" | "error"
  >("claiming");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setRevision] = useState(0);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      try {
        const parsedInviteId = parseInviteId(inviteId);
        if (!pairingSecret) {
          throw new Error("Invite URL is missing PairingSecret.");
        }

        const parsedPairingSecret = parsePairingSecret(pairingSecret);

        const invitationClient = new InvitationClient(coordinatorBaseUrl);
        const claimed = await invitationClient.claimInvite(
          parsedInviteId,
          claimId,
        );
        if (disposed) return;

        setClaimState("claimed");
        setExpiresAt(claimed.expiresAt);

        const joinedProject =
          await storage.initializeJoinedProject(claimed.projectId);
        if (disposed) return;

        const transport = new WebRtcTransport(
          claimed.projectId,
          undefined,
          createConsoleDebugLogger("invite-join-webrtc"),
        );
        const stopTransportStatus =
          transport.onStatusChange(setWebRtcStatus);
        const stopPersistence = storage.watchProject(joinedProject);
        const stopProject = joinedProject.subscribe(() => {
          setRevision((value) => value + 1);
        });

        const abortPairing = new AbortController();
        let syncEngine: ProjectSyncEngine | null = null;

        const signaling = new WebRtcSignalingSession({
          role: "join",
          coordinatorBaseUrl,
          projectId: claimed.projectId,
          sessionId: claimed.sessionId,
          transport,
          debugLogger: createConsoleDebugLogger("invite-join-signal"),
        });
        const stopSignalingState =
          signaling.onConnectionStateChange(setSignalingState);
        signaling.start();

        await authenticatePairingChannel({
          role: "join",
          inviteId: parsedInviteId,
          projectId: claimed.projectId,
          sessionId: claimed.sessionId,
          pairingSecret: parsedPairingSecret,
          transport,
          signal: abortPairing.signal,
        });
        if (disposed) {
          abortPairing.abort();
          return;
        }

        syncEngine = new ProjectSyncEngine(joinedProject, transport, {
          debugLogger: createConsoleDebugLogger("invite-join-sync"),
        });
        syncEngine.start();

        cleanup = () => {
          abortPairing.abort();
          stopSignalingState();
          signaling.stop();
          stopProject();
          stopPersistence();
          stopTransportStatus();
          syncEngine?.stop();
        };

        setProject(joinedProject);
      } catch (caught: unknown) {
        setClaimState("error");
        setError(
          caught instanceof Error ? caught.message : "Failed to claim invite",
        );
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [claimId, coordinatorBaseUrl, inviteId, pairingSecret, storage]);

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
        <p className="eyebrow">Invitation bootstrap</p>
        <h1>Joining Floe Note Project</h1>

        <p className="webrtc-status">
          Invite: <strong>{claimState}</strong>
        </p>
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
          Data channel: <strong>{webRtcStatus.dataChannelState}</strong>
        </p>
        {expiresAt ? (
          <p className="webrtc-status">
            Invite expires:{" "}
            <strong>{new Date(expiresAt).toLocaleTimeString()}</strong>
          </p>
        ) : null}

        <p className="join-live-hint">
          PairingSecret is used to authenticate the temporary WebRTC pairing
          channel before any Project synchronization starts. The coordinator
          still sees only the InviteId bootstrap and signaling metadata.
        </p>

        {webRtcStatus.warning ? (
          <p className="webrtc-warning">{webRtcStatus.warning}</p>
        ) : null}
        {webRtcStatus.error ? (
          <p className="webrtc-error">{webRtcStatus.error}</p>
        ) : null}

        {project ? (
          <section className="join-result">
            <JoinedProjectEditor project={project} />
          </section>
        ) : (
          <p className="join-live-hint">Claiming invite…</p>
        )}
      </section>
    </main>
  );
}
