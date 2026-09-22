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

type InvitationHostPanelProps = {
  inviteId: InviteId;
  pairingSecret: PairingSecret;
  expiresAt: number;
  transport: WebRtcTransport;
  signalingState: SignalingConnectionState;
  joiningDeviceId: DeviceId | null;
  onCancel: () => Promise<void>;
};

export function InvitationHostPanel({
  inviteId,
  pairingSecret,
  expiresAt,
  transport,
  signalingState,
  joiningDeviceId,
  onCancel,
}: InvitationHostPanelProps) {
  const [status, setStatus] = useState<WebRtcStatus>(transport.status);
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

  async function cancelInvite() {
    setCancelState("cancelling");
    try {
      await onCancel();
      setCancelState("cancelled");
    } catch {
      setCancelState("error");
    }
  }

  return (
    <section className="webrtc-debug-panel">
      <p className="eyebrow">Invitation bootstrap</p>
      <p className="webrtc-status">
        Signaling: <strong>{signalingState}</strong>
      </p>
      <p className="webrtc-status">
        Peer connection: <strong>{status.connectionState}</strong>
      </p>
      <p className="webrtc-status">
        ICE connection: <strong>{status.iceConnectionState}</strong>
      </p>
      <p className="webrtc-status">
        Data channel: <strong>{status.dataChannelState}</strong>
      </p>
      <p className="webrtc-status">
        Expires: <strong>{new Date(expiresAt).toLocaleTimeString()}</strong>
      </p>
      <p className="webrtc-status">
        Joining device: <strong>{joiningDeviceId ?? "waiting"}</strong>
      </p>

      <label className="webrtc-field">
        <span>Invite URL</span>
        <textarea readOnly value={inviteUrl} rows={5} />
      </label>

      <p className="webrtc-hint">
        The URL exposes only InviteId to the coordinator request. PairingSecret
        stays in the URL fragment and is not sent to the coordinator.
      </p>

      <button
        className="invite-cancel-button"
        type="button"
        onClick={() => void cancelInvite()}
        disabled={cancelState === "cancelling" || cancelState === "cancelled"}
      >
        {cancelState === "cancelled"
          ? "Invite cancelled"
          : cancelState === "cancelling"
            ? "Cancelling…"
            : "Cancel invite"}
      </button>

      {cancelState === "error" ? (
        <p className="webrtc-error">Could not cancel invite.</p>
      ) : null}
      {status.warning ? (
        <p className="webrtc-warning">{status.warning}</p>
      ) : null}
      {status.error ? <p className="webrtc-error">{status.error}</p> : null}
    </section>
  );
}
