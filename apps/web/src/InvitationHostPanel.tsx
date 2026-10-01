import type {
  InviteId,
  PairingSecret,
  SignalingConnectionState,
} from "@floe-note/coordinator-client";
import type { DeviceId } from "@floe-note/domain";
import type {
  WebRtcStatus,
  WebRtcTransport,
} from "@floe-note/transport/webrtc";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export type DeviceAuthorizationUiState =
  | "waiting"
  | "ready"
  | "authorizing"
  | "authorized"
  | "error";

export type WorkspaceKeyDeliveryUiState =
  | "waiting"
  | "delivering"
  | "delivered"
  | "error";

type InvitationHostPanelProps = {
  inviteId: InviteId;
  pairingSecret: PairingSecret;
  expiresAt: number;
  transport: WebRtcTransport;
  signalingState: SignalingConnectionState;
  joiningDeviceId: DeviceId | null;
  joiningDeviceName: string | null;
  authorizationState: DeviceAuthorizationUiState;
  workspaceKeyDeliveryState: WorkspaceKeyDeliveryUiState;
  error: string | null;
  onConfirm: () => Promise<void>;
  onRetryWorkspaceKeyDelivery: () => Promise<void>;
  onCancel: () => Promise<void>;
};

function shortDeviceId(deviceId: DeviceId): string {
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
}


function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.7 12.3 12.3 7.7" />
      <path d="M6.2 14.8H5.1a3.9 3.9 0 0 1 0-7.8h2.1" />
      <path d="M12.8 7h2.1a3.9 3.9 0 0 1 0 7.8h-2.1" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.8" />
      <path d="M13.5 6.5V5.2A1.7 1.7 0 0 0 11.8 3.5H5.2A1.7 1.7 0 0 0 3.5 5.2v6.6a1.7 1.7 0 0 0 1.7 1.7h1.3" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 8.5v5" />
      <circle cx="10" cy="5.8" r="0.8" />
    </svg>
  );
}

export function InvitationHostPanel({
  inviteId,
  pairingSecret,
  expiresAt,
  transport,
  signalingState,
  joiningDeviceId,
  joiningDeviceName,
  authorizationState,
  workspaceKeyDeliveryState,
  error,
  onConfirm,
  onRetryWorkspaceKeyDelivery,
  onCancel,
}: InvitationHostPanelProps) {
  const [status, setStatus] = useState<WebRtcStatus>(transport.status);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [cancelState, setCancelState] = useState<
    "idle" | "cancelling" | "cancelled" | "error"
  >("idle");

  useEffect(() => transport.onStatusChange(setStatus), [transport]);

  const inviteUrl = useMemo(() => {
    const url = new URL(window.location.origin);
    url.pathname = `/join/v1/${inviteId}`;
    url.hash = `s=${pairingSecret}`;
    return url.toString();
  }, [inviteId, pairingSecret]);

  async function copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1_500);
    } catch {
      setCopyState("error");
    }
  }

  async function cancelInvite(): Promise<void> {
    setCancelState("cancelling");
    try {
      await onCancel();
      setCancelState("cancelled");
    } catch {
      setCancelState("error");
    }
  }

  const pairingComplete = workspaceKeyDeliveryState === "delivered";

  return (
    <section className="invitation-host-view">
      <header className="settings-header invitation-host-header">
        <p className="settings-eyebrow">Devices</p>
        <h1>Add a device</h1>
        <p>
          Open this invitation on the device you want to add. You will approve
          the device here before Workspace access is granted.
        </p>
      </header>

      <div className="invitation-section">
        <div className="invitation-section-heading">
          <span className="invitation-step-number">1</span>
          <div>
            <h2>Send the invitation</h2>
            <p>The link expires at {new Date(expiresAt).toLocaleTimeString()}.</p>
          </div>
        </div>

        <div className="invitation-share-card">
          <div className="invitation-qr-card">
            <div className="invitation-qr-surface">
              <QRCodeSVG
                className="invitation-qr-code"
                value={inviteUrl}
                size={208}
                level="M"
                marginSize={4}
                bgColor="#ffffff"
                fgColor="#111111"
                title="Invitation QR code"
              />
            </div>
            <p>Scan with the device you want to add.</p>
          </div>

          <div className="invitation-link-option">
            <div className="invitation-link-heading">
              <span className="invitation-share-icon">
                <LinkIcon />
              </span>
              <strong>Invitation link</strong>
            </div>

            <div className="invite-link-box">
              <input
                aria-label="Invitation link"
                readOnly
                value={inviteUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                className="settings-primary-action invite-copy-button"
                type="button"
                onClick={() => void copyInvite()}
              >
                <CopyIcon />
                <span>{copyState === "copied" ? "Copied" : "Copy link"}</span>
              </button>
            </div>
            {copyState === "error" ? (
              <p className="dialog-error">
                Could not copy automatically. Select the link and copy it manually.
              </p>
            ) : null}
            <div className="invitation-secret-note">
              <span className="invitation-share-icon muted">
                <InfoIcon />
              </span>
              <p>
                The QR code and link contain the same invitation secret. The
                secret stays in the URL fragment and is not sent to the
                coordinator.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="invitation-section">
        <div className="invitation-section-heading">
          <span className="invitation-step-number">2</span>
          <div>
            <h2>Approve the device</h2>
            <p>
              Check the device name before granting access to this Workspace.
            </p>
          </div>
        </div>

        {joiningDeviceId ? (
          <div className="device-approval-card">
            <div className="device-approval-identity">
              <span className="device-avatar large" aria-hidden="true">◇</span>
              <div>
                <strong>{joiningDeviceName ?? "Unnamed device"}</strong>
                <p>{shortDeviceId(joiningDeviceId)}</p>
              </div>
            </div>

            {authorizationState === "authorized" ? (
              <span className="settings-badge">
                {pairingComplete ? "Added" : "Approved"}
              </span>
            ) : (
              <button
                className="dialog-primary-button"
                type="button"
                onClick={() => void onConfirm()}
                disabled={
                  authorizationState === "waiting" ||
                  authorizationState === "authorizing"
                }
              >
                {authorizationState === "authorizing"
                  ? "Approving…"
                  : authorizationState === "error"
                    ? "Try again"
                    : "Approve device"}
              </button>
            )}
          </div>
        ) : (
          <div className="invitation-waiting-card">
            <span className="invitation-pulse" aria-hidden="true" />
            <div>
              <strong>Waiting for the other device</strong>
              <p>Keep this page open after opening the invitation link.</p>
            </div>
          </div>
        )}

        {authorizationState === "authorized" &&
        workspaceKeyDeliveryState !== "delivered" ? (
          <div className="invitation-progress-row">
            <span className="invitation-pulse" aria-hidden="true" />
            <p>
              {workspaceKeyDeliveryState === "error"
                ? "Workspace access could not be delivered."
                : "Securely delivering Workspace access…"}
            </p>
            {workspaceKeyDeliveryState === "error" ? (
              <button
                className="settings-primary-action"
                type="button"
                onClick={() => void onRetryWorkspaceKeyDelivery()}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {pairingComplete ? (
          <div className="invitation-success">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Device added</strong>
              <p>Opening your Workspace…</p>
            </div>
          </div>
        ) : null}

        {authorizationState === "error" ? (
          <p className="dialog-error">
            {error ?? "Could not approve this device."}
          </p>
        ) : null}
        {authorizationState !== "error" && error ? (
          <p className="dialog-error">{error}</p>
        ) : null}
      </div>

      <div className="invitation-host-footer">
        <button
          className="dialog-secondary-button"
          type="button"
          onClick={() => void cancelInvite()}
          disabled={
            cancelState === "cancelling" ||
            cancelState === "cancelled" ||
            pairingComplete
          }
        >
          {cancelState === "cancelled"
            ? "Invitation cancelled"
            : cancelState === "cancelling"
              ? "Cancelling…"
              : "Cancel invitation"}
        </button>

        {cancelState === "error" ? (
          <p className="dialog-error">Could not cancel invitation.</p>
        ) : null}
      </div>

      <details className="technical-details invitation-technical-details">
        <summary>Technical details</summary>
        <dl>
          <div>
            <dt>Signaling</dt>
            <dd>{signalingState}</dd>
          </div>
          <div>
            <dt>Peer connection</dt>
            <dd>{status.connectionState}</dd>
          </div>
          <div>
            <dt>ICE</dt>
            <dd>{status.iceConnectionState}</dd>
          </div>
          <div>
            <dt>Data channel</dt>
            <dd>{status.dataChannelState}</dd>
          </div>
          {joiningDeviceId ? (
            <div>
              <dt>Device ID</dt>
              <dd>{joiningDeviceId}</dd>
            </div>
          ) : null}
        </dl>
      </details>

      {status.warning ? (
        <p className="webrtc-warning">{status.warning}</p>
      ) : null}
      {status.error ? <p className="webrtc-error">{status.error}</p> : null}
    </section>
  );
}
