import type { DeviceId } from "@floe-note/domain";

import type { SyncUiState } from "./SyncStatus.js";

export type SyncUiInput = {
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
  presenceState,
  onlineDeviceIds,
  ownsAutomaticPeerSync,
  connectedDeviceIds,
  localDeviceId,
  error,
}: SyncUiInput): SyncUiState {
  if (error) {
    return { kind: "error", detail: error };
  }

  if (ownsAutomaticPeerSync && connectedDeviceIds.length > 0) {
    return { kind: "connected" };
  }

  if (presenceState === "connecting" || presenceState === "authenticating") {
    return { kind: "connecting" };
  }

  if (presenceState === "closed" || presenceState === "error") {
    return { kind: "offline" };
  }

  if (presenceState !== "open" || !localDeviceId) {
    return { kind: "quiet" };
  }

  const otherDeviceOnline = onlineDeviceIds.some(
    (deviceId) => deviceId !== localDeviceId,
  );
  if (!otherDeviceOnline) return { kind: "quiet" };
  return ownsAutomaticPeerSync ? { kind: "connecting" } : { kind: "online" };
}
