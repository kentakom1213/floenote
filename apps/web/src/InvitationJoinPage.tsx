import {
  createClaimId,
  InvitationClient,
  parseInviteId,
  parsePairingSecret,
  WebRtcSignalingSession,
  type SignalingConnectionState,
} from "@floe-note/coordinator-client";
import type { DeviceId } from "@floe-note/domain";
import {
  authenticatePairingChannel,
  exchangeJoiningDeviceIdentity,
} from "@floe-note/pairing";
import {
  WebRtcTransport,
  type WebRtcStatus,
} from "@floe-note/transport/webrtc";
import {
  WebAuthnPrfDeviceVault,
  type DeviceVaultSession,
} from "@floe-note/vault";
import { useEffect, useRef, useState } from "react";

import { createConsoleDebugLogger } from "./debug.js";

const joinDeviceVault = new WebAuthnPrfDeviceVault();

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
  coordinatorBaseUrl: string;
  inviteId: string;
  pairingSecret: string | null;
};

type JoinVaultState =
  | "checking"
  | "missing"
  | "locked"
  | "unlocking"
  | "unlocked"
  | "error";

type PairingState =
  | "waiting-for-vault"
  | "connecting"
  | "awaiting-authorization"
  | "error";

export function InvitationJoinPage({
  coordinatorBaseUrl,
  inviteId,
  pairingSecret,
}: InvitationJoinPageProps) {
  const [claimId] = useState(() => createClaimId());
  const vaultSessionRef = useRef<DeviceVaultSession | null>(null);
  const [vaultState, setVaultState] = useState<JoinVaultState>("checking");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [webRtcStatus, setWebRtcStatus] =
    useState<WebRtcStatus>(INITIAL_WEBRTC_STATUS);
  const [signalingState, setSignalingState] =
    useState<SignalingConnectionState>("idle");
  const [claimState, setClaimState] = useState<
    "waiting" | "claiming" | "claimed" | "error"
  >("waiting");
  const [pairingState, setPairingState] =
    useState<PairingState>("waiting-for-vault");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [deviceId, setDeviceId] = useState<DeviceId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void joinDeviceVault
      .hasVault()
      .then((exists) => {
        if (!cancelled) {
          setVaultState(exists ? "locked" : "missing");
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setVaultState("error");
          setVaultError(
            caught instanceof Error
              ? caught.message
              : "Failed to inspect Device Vault",
          );
        }
      });

    return () => {
      cancelled = true;
      const session = vaultSessionRef.current;
      vaultSessionRef.current = null;
      if (session) void session.close();
    };
  }, []);

  useEffect(() => {
    if (vaultState !== "unlocked" || !deviceId) return;

    const session = vaultSessionRef.current;
    if (!session) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    setClaimState("claiming");
    setPairingState("connecting");
    setError(null);

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

        const transport = new WebRtcTransport(
          claimed.projectId,
          undefined,
          createConsoleDebugLogger("invite-join-webrtc"),
        );
        const stopTransportStatus = transport.onStatusChange(setWebRtcStatus);
        const abortPairing = new AbortController();

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

        cleanup = () => {
          abortPairing.abort();
          stopSignalingState();
          signaling.stop();
          stopTransportStatus();
        };

        await authenticatePairingChannel({
          role: "join",
          inviteId: parsedInviteId,
          projectId: claimed.projectId,
          sessionId: claimed.sessionId,
          pairingSecret: parsedPairingSecret,
          transport,
          signal: abortPairing.signal,
        });
        if (disposed) return;

        const identity = await exchangeJoiningDeviceIdentity({
          role: "join",
          transport,
          identity: session.publicIdentity,
          signal: abortPairing.signal,
        });
        if (disposed) return;

        if (identity.deviceId !== deviceId) {
          throw new Error("Device Vault identity changed during pairing");
        }

        setPairingState("awaiting-authorization");
      } catch (caught: unknown) {
        cleanup?.();
        cleanup = null;
        if (disposed) return;
        setClaimState("error");
        setPairingState("error");
        setError(
          caught instanceof Error ? caught.message : "Failed to join Project",
        );
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [
    claimId,
    coordinatorBaseUrl,
    deviceId,
    inviteId,
    pairingSecret,
    vaultState,
  ]);

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
        <p className="webrtc-status">
          Device ID: <strong>{deviceId ?? "not generated"}</strong>
        </p>

        <p className="join-live-hint">
          PairingSecret authenticates the temporary WebRTC pairing channel.
          After authentication, this device creates separate encryption and
          signing keys and sends only its public identity to the existing
          device. The claimed Project remains in memory only until device
          authorization and ProjectKey delivery are implemented.
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
          <p className="join-live-hint">
            Authenticating pairing and preparing device identity…
          </p>
        )}
      </section>
    </main>
  );
}
