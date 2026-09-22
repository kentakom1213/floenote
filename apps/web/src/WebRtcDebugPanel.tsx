import { useEffect, useState } from "react";

import type { ProjectId } from "@floe-note/domain";
import type {
  WebRtcConnectionState,
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
  const [connectionState, setConnectionState] =
    useState<WebRtcConnectionState>(transport.connectionState);
  const [localDescription, setLocalDescription] = useState("");
  const [remoteDescription, setRemoteDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => transport.onConnectionStateChange(setConnectionState),
    [transport],
  );

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
        Connection: <strong>{connectionState}</strong>
      </p>
      <p className="webrtc-project-id" title={projectId}>
        Project: {projectId}
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

      {error ? <p className="webrtc-error">{error}</p> : null}
    </section>
  );
}
