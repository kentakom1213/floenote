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
  receiveProjectKeyDelivery,
} from "@floe-note/pairing";
import type { ProjectStorage } from "@floe-note/storage";
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
  storage: ProjectStorage;
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
  | "identity-sent"
  | "key-stored"
  | "error";

export function InvitationJoinPage({
  coordinatorBaseUrl,
  inviteId,
  pairingSecret,
  storage,
}: InvitationJoinPageProps) {
  const [claimId] = useState(() => createClaimId());
  const vaultSessionRef = useRef<DeviceVaultSession | null>(null);
  const [vaultState, setVaultState] = useState<JoinVaultState>("checking");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
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
          throw new Error("This invitation link is incomplete.");
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

        const deliveryPromise = receiveProjectKeyDelivery({
          transport,
          projectId: claimed.projectId,
          recipientIdentity: session.publicIdentity,
          signal: abortPairing.signal,
          timeoutMs: Math.max(1_000, claimed.expiresAt - Date.now()),
          onDelivery: async ({ securityState, sealedEnvelope }) => {
            await session.storeSealedProjectKey(
              sealedEnvelope,
              securityState.projectId,
              securityState.keyEpoch,
              securityState.headHash,
            );
            await storage.saveCommittedSecurityState(securityState);
            const joinedProject = await storage.initializeJoinedProject(
              securityState.projectId,
              session,
              securityState.keyEpoch,
            );
            joinedProject.setDeviceDisplayName(
              session.publicIdentity.deviceId,
              session.displayName,
            );
          },
        });
        void deliveryPromise.catch(() => undefined);

        const identity = await exchangeJoiningDeviceIdentity({
          role: "join",
          transport,
          identity: session.publicIdentity,
          displayName: session.displayName,
          signal: abortPairing.signal,
        });
        if (disposed) return;

        if (identity.deviceId !== deviceId) {
          throw new Error("Device identity changed during pairing");
        }

        setPairingState("identity-sent");

        await deliveryPromise;
        if (disposed) return;

        setPairingState("key-stored");

        cleanup?.();
        cleanup = null;

        window.setTimeout(() => {
          if (!disposed) window.location.replace("/");
        }, 0);
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
    storage,
    vaultState,
  ]);

  async function unlockOrCreateDevice(): Promise<void> {
    if (vaultState === "unlocking" || vaultState === "unlocked") return;
    if (vaultState === "missing" && deviceName.trim().length === 0) return;

    setVaultState("unlocking");
    setVaultError(null);

    try {
      const session = await joinDeviceVault.unlockOrCreate(
        vaultState === "missing" ? deviceName.trim() : undefined,
      );
      const previous = vaultSessionRef.current;
      vaultSessionRef.current = session;
      if (previous) await previous.close();

      setDeviceName(session.displayName);
      setDeviceId(session.publicIdentity.deviceId);
      setVaultState("unlocked");
    } catch (caught: unknown) {
      setVaultState("error");
      setVaultError(
        caught instanceof Error
          ? caught.message
          : "Failed to unlock Device Vault",
      );
    }
  }

  const progressCopy =
    pairingState === "key-stored"
      ? {
          title: "Device added",
          detail: "Project access is ready. Opening Floe Note…",
        }
      : pairingState === "identity-sent"
        ? {
            title: "Waiting for approval",
            detail: `Approve “${deviceName}” on your existing device.`,
          }
        : pairingState === "error"
          ? {
              title: "Could not join",
              detail: error ?? "The invitation could not be completed.",
            }
          : {
              title: "Connecting securely",
              detail: "Keep this page open while Floe Note connects to your existing device.",
            };

  return (
    <main className="join-page invitation-page">
      <section className="invitation-join-card">
        <div className="invitation-brand">
          <span className="floe-mark" aria-hidden="true">◆</span>
          <span>Floe Note</span>
        </div>

        <p className="settings-eyebrow">Device invitation</p>
        <h1>Join a Project</h1>

        {vaultState !== "unlocked" ? (
          <div className="invitation-step-card">
            <span className="invitation-step-number">1</span>
            <div className="invitation-step-copy">
              <strong>
                {vaultState === "missing"
                  ? "Set up this device"
                  : "Unlock this device"}
              </strong>
              <p>
                {vaultState === "missing"
                  ? "Choose a name that will identify this device on your other devices."
                  : "Unlock the Device Vault before joining the Project."}
              </p>

              {vaultState === "missing" ? (
                <label className="settings-field invitation-name-field">
                  <span>Device name</span>
                  <input
                    autoFocus
                    maxLength={80}
                    value={deviceName}
                    placeholder="Kenta's Pixel"
                    onChange={(event) => setDeviceName(event.target.value)}
                  />
                </label>
              ) : null}

              {vaultState !== "checking" ? (
                <button
                  className="dialog-primary-button invitation-primary"
                  type="button"
                  onClick={() => void unlockOrCreateDevice()}
                  disabled={
                    vaultState === "unlocking" ||
                    (vaultState === "missing" &&
                      deviceName.trim().length === 0)
                  }
                >
                  {vaultState === "unlocking"
                    ? "Unlocking…"
                    : vaultState === "missing"
                      ? "Set up and continue"
                      : "Unlock and continue"}
                </button>
              ) : (
                <p className="settings-loading">Checking this device…</p>
              )}

              {vaultError ? (
                <p className="dialog-error">{vaultError}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="invitation-step-card active">
            <span className="invitation-step-number">2</span>
            <div className="invitation-step-copy">
              <strong>{progressCopy.title}</strong>
              <p>{progressCopy.detail}</p>
              <div className="joining-device-chip">
                <span className="device-avatar" aria-hidden="true">◇</span>
                <span>
                  <strong>{deviceName}</strong>
                  <small>This device</small>
                </span>
              </div>
            </div>
          </div>
        )}

        {expiresAt ? (
          <p className="invitation-expiry">
            Invitation expires at {new Date(expiresAt).toLocaleTimeString()}.
          </p>
        ) : null}

        {error && pairingState !== "error" ? (
          <p className="dialog-error">{error}</p>
        ) : null}

        <details className="technical-details invitation-technical-details">
          <summary>Technical details</summary>
          <dl>
            <div>
              <dt>Device ID</dt>
              <dd>{deviceId ?? "Not unlocked"}</dd>
            </div>
            <div>
              <dt>Invitation</dt>
              <dd>{claimState}</dd>
            </div>
            <div>
              <dt>Signaling</dt>
              <dd>{signalingState}</dd>
            </div>
            <div>
              <dt>Peer connection</dt>
              <dd>{webRtcStatus.connectionState}</dd>
            </div>
            <div>
              <dt>Data channel</dt>
              <dd>{webRtcStatus.dataChannelState}</dd>
            </div>
          </dl>
        </details>

        {webRtcStatus.warning ? (
          <p className="webrtc-warning">{webRtcStatus.warning}</p>
        ) : null}
        {webRtcStatus.error ? (
          <p className="webrtc-error">{webRtcStatus.error}</p>
        ) : null}
      </section>
    </main>
  );
}
