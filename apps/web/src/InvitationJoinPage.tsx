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
import { generateDeviceDisplayName } from "./device-name.js";
import { clearAllLastDocumentPreferences } from "./note-preference.js";
import { resolveRtcConfiguration } from "./turn-credentials.js";

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
  turnCredentialEndpoint: string | null;
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
  turnCredentialEndpoint,
}: InvitationJoinPageProps) {
  const [claimId] = useState(() => createClaimId());
  const vaultSessionRef = useRef<DeviceVaultSession | null>(null);
  const [vaultState, setVaultState] = useState<JoinVaultState>("checking");
  const [needsDeviceSetup, setNeedsDeviceSetup] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState(generateDeviceDisplayName);
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
          setNeedsDeviceSetup(!exists);
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
          await resolveRtcConfiguration(turnCredentialEndpoint),
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
            await storage.initializeJoinedProject(
              securityState.projectId,
              session,
              securityState.keyEpoch,
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
    turnCredentialEndpoint,
    vaultState,
  ]);

  async function openDeviceVault(
    open: () => Promise<DeviceVaultSession>,
  ): Promise<void> {
    if (vaultState === "unlocking" || vaultState === "unlocked") return;

    setVaultState("unlocking");
    setVaultError(null);

    try {
      const session = await open();
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

  async function unlockDevice(): Promise<void> {
    await openDeviceVault(() => joinDeviceVault.unlock());
  }

  async function createWithExistingPasskey(): Promise<void> {
    const displayName = deviceName.trim();
    if (!displayName) return;

    await openDeviceVault(() =>
      joinDeviceVault.createWithExistingPasskey(displayName),
    );
  }

  async function createWithNewPasskey(): Promise<void> {
    const displayName = deviceName.trim();
    if (!displayName) return;

    await openDeviceVault(() =>
      joinDeviceVault.createWithNewPasskey(displayName),
    );
  }

  async function resetDevice(): Promise<void> {
    const confirmed = window.confirm(
      "Reset this device? This deletes the local Device Vault and all local Project data. You will need another authorized device to complete this invitation.",
    );
    if (!confirmed) return;

    setVaultState("unlocking");
    setVaultError(null);

    try {
      const session = vaultSessionRef.current;
      vaultSessionRef.current = null;
      if (session) await session.close();

      await storage.eraseAllLocalData();
      await joinDeviceVault.eraseVault();
      clearAllLastDocumentPreferences();
      window.location.reload();
    } catch (caught: unknown) {
      setVaultState("error");
      setVaultError(
        caught instanceof Error
          ? caught.message
          : "Failed to reset this device",
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
                {needsDeviceSetup
                  ? "Set up this device"
                  : "Unlock this device"}
              </strong>
              <p>
                {needsDeviceSetup
                  ? "Choose a name that will identify this device on your other devices."
                  : "Unlock the Device Vault before joining the Project."}
              </p>

              {needsDeviceSetup ? (
                <label className="settings-field invitation-name-field">
                  <span>Device name</span>
                  <input
                    autoFocus
                    maxLength={80}
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                  />
                </label>
              ) : null}

              {vaultState !== "checking" ? (
                needsDeviceSetup ? (
                  <>
                    <div className="invitation-vault-actions">
                      <button
                        className="dialog-primary-button invitation-primary"
                        type="button"
                        onClick={() => void createWithExistingPasskey()}
                        disabled={
                          vaultState === "unlocking" ||
                          deviceName.trim().length === 0
                        }
                      >
                        {vaultState === "unlocking"
                          ? "Waiting for passkey…"
                          : "Use existing passkey"}
                      </button>
                      <button
                        className="dialog-secondary-button"
                        type="button"
                        onClick={() => void createWithNewPasskey()}
                        disabled={
                          vaultState === "unlocking" ||
                          deviceName.trim().length === 0
                        }
                      >
                        Create new passkey
                      </button>
                    </div>
                    <p className="invitation-passkey-note">
                      Reuse a synced Floe Note passkey when one is already
                      available on this device.
                    </p>
                  </>
                ) : (
                  <button
                    className="dialog-primary-button invitation-primary"
                    type="button"
                    onClick={() => void unlockDevice()}
                    disabled={vaultState === "unlocking"}
                  >
                    {vaultState === "unlocking"
                      ? "Unlocking…"
                      : "Unlock and continue"}
                  </button>
                )
              ) : (
                <p className="settings-loading">Checking this device…</p>
              )}

              {vaultError ? (
                <p className="dialog-error">{vaultError}</p>
              ) : null}

              {!needsDeviceSetup && vaultState === "error" ? (
                <div className="invitation-reset-vault">
                  <p>
                    If the passkey was deleted, this local Vault cannot be
                    recovered in v1.
                  </p>
                  <button type="button" onClick={() => void resetDevice()}>
                    Reset this device
                  </button>
                </div>
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
