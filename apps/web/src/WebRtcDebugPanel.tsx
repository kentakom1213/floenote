import { useEffect, useState } from "react";

import type { ProjectId } from "@floe-note/domain";
import type {
  WebRtcStatus,
  WebRtcTransport,
} from "@floe-note/transport/webrtc";

type WebRtcDebugPanelProps = {
  projectId: ProjectId;
  transport: WebRtcTransport;
};

export function WebRtcDebugPanel({
  projectId,
  transport,
}: WebRtcDebugPanelProps) {
  const [status, setStatus] = useState<WebRtcStatus>(transport.status);
  const [localDescription, setLocalDescription] = useState("");
  const [remoteDescription, setRemoteDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => transport.onStatusChange(setStatus), [transport]);

  async function createOffer() {
    await run(async () => {
      setLocalDescription(await transport.createOffer());
    });
  }

  async function acceptOffer() {
    await run(async () => {
      setLocalDescription(
        await transport.acceptOffer(remoteDescription.trim()),
      );
    });
  }

  async function acceptAnswer() {
    await run(async () => {
      await transport.acceptAnswer(remoteDescription.trim());
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);

    try {
      await action();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "WebRTC operation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="webrtc-debug-panel">
      <p className="eyebrow">Manual WebRTC</p>
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

      <label className="webrtc-field">
        <span>Project ID</span>
        <input readOnly value={projectId} />
      </label>

      <p className="webrtc-hint">
        A fresh browser can join this Project at <code>?join=webrtc</code>.
      </p>

      <div className="webrtc-actions">
        <button type="button" onClick={createOffer} disabled={busy}>
          Create offer
        </button>
        <button
          type="button"
          onClick={acceptOffer}
          disabled={busy || remoteDescription.trim() === ""}
        >
          Accept offer + answer
        </button>
        <button
          type="button"
          onClick={acceptAnswer}
          disabled={busy || remoteDescription.trim() === ""}
        >
          Accept answer
        </button>
      </div>

      <label className="webrtc-field">
        <span>Local description</span>
        <textarea readOnly value={localDescription} rows={5} />
      </label>

      <label className="webrtc-field">
        <span>Remote description</span>
        <textarea
          value={remoteDescription}
          onChange={(event) => setRemoteDescription(event.target.value)}
          rows={5}
          placeholder="Paste offer or answer JSON here"
        />
      </label>

      {status.warning ? (
        <p className="webrtc-warning">{status.warning}</p>
      ) : null}
      {status.error ? <p className="webrtc-error">{status.error}</p> : null}
      {error ? <p className="webrtc-error">{error}</p> : null}
    </section>
  );
}
