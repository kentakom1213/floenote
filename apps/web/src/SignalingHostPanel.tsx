import type {
  SessionId,
  SignalingConnectionState,
} from "@floe-note/coordinator-client";
import type { ProjectId } from "@floe-note/domain";
import type {
  WebRtcStatus,
  WebRtcTransport,
} from "@floe-note/transport/webrtc";
import { useEffect, useMemo, useState } from "react";

type SignalingHostPanelProps = {
  projectId: ProjectId;
  sessionId: SessionId;
  transport: WebRtcTransport;
  signalingState: SignalingConnectionState;
};

export function SignalingHostPanel({
  projectId,
  sessionId,
  transport,
  signalingState,
}: SignalingHostPanelProps) {
  const [status, setStatus] = useState<WebRtcStatus>(transport.status);

  useEffect(() => transport.onStatusChange(setStatus), [transport]);

  const joinUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("join", "signal");
    url.searchParams.set("project", projectId);
    url.searchParams.set("session", sessionId);
    return url.toString();
  }, [projectId, sessionId]);

  return (
    <section className="webrtc-debug-panel">
      <p className="eyebrow">Cloudflare signaling</p>
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

      <label className="webrtc-field">
        <span>Join URL</span>
        <textarea readOnly value={joinUrl} rows={4} />
      </label>

      <p className="webrtc-hint">
        Open this URL in the other browser. Offer, answer, and ICE candidates
        are relayed automatically through the coordinator.
      </p>

      {status.warning ? (
        <p className="webrtc-warning">{status.warning}</p>
      ) : null}
      {status.error ? <p className="webrtc-error">{status.error}</p> : null}
    </section>
  );
}
