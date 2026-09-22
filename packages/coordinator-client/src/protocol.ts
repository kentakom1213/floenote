export type WebRtcSignal =
  | {
      type: "offer";
      description: RTCSessionDescriptionInit;
    }
  | {
      type: "answer";
      description: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      candidate: RTCIceCandidateInit | null;
    };

export type CoordinatorServerMessage =
  | { type: "peer-ready" }
  | { type: "peer-left" }
  | { type: "signal"; signal: WebRtcSignal };

export function encodeSignal(signal: WebRtcSignal): string {
  return JSON.stringify({
    type: "signal",
    signal,
  });
}

export function decodeServerMessage(raw: string): CoordinatorServerMessage {
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new Error("Invalid coordinator message");
  }

  if (parsed.type === "peer-ready") {
    return { type: "peer-ready" };
  }

  if (parsed.type === "peer-left") {
    return { type: "peer-left" };
  }

  if (parsed.type === "signal" && isWebRtcSignal(parsed.signal)) {
    return {
      type: "signal",
      signal: parsed.signal,
    };
  }

  throw new Error("Unknown coordinator message");
}

function isWebRtcSignal(value: unknown): value is WebRtcSignal {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "ice-candidate") {
    return value.candidate === null || isRecord(value.candidate);
  }

  if (value.type === "offer" || value.type === "answer") {
    return (
      isRecord(value.description) &&
      value.description.type === value.type &&
      typeof value.description.sdp === "string"
    );
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
