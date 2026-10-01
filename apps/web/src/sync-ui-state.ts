import type { DeviceId } from "@floe-note/domain";

import type { SyncUiState } from "./SyncStatus.js";

export type SyncUiInput = {
  browserOnline: boolean;
  presenceState:
    | "idle"
    | "connecting"
    | "authenticating"
    | "open"
    | "closed"
    | "error";
  onlineDeviceIds: readonly DeviceId[];
  ownsAutomaticPeerSync: boolean;
  connectedDeviceIds: readonly DeviceId[];
  localDeviceId: DeviceId | null;
  error: string | null;
};

export function deriveSyncUiState({
  browserOnline,
  presenceState,
  onlineDeviceIds,
  ownsAutomaticPeerSync,
  connectedDeviceIds,
  localDeviceId,
  error,
}: SyncUiInput): SyncUiState {
  if (!browserOnline) {
    return { kind: "offline" };
  }

  if (ownsAutomaticPeerSync && connectedDeviceIds.length > 0) {
    return { kind: "connected" };
  }

  if (error) {
    return { kind: "error", detail: error };
  }

  if (presenceState === "connecting" || presenceState === "authenticating") {
    return { kind: "connecting" };
  }

  if (presenceState === "closed" || presenceState === "error") {
    return {
      kind: "error",
      detail: "Coordinator connection is unavailable",
    };
  }

  if (presenceState !== "open" || !localDeviceId) {
    return { kind: "quiet" };
  }

  const otherDeviceOnline = onlineDeviceIds.some(
    (deviceId) => deviceId !== localDeviceId,
  );
  if (!otherDeviceOnline) return { kind: "quiet" };
  return ownsAutomaticPeerSync
    ? { kind: "connecting" }
    : { kind: "available" };
}
