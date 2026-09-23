import type { DeviceId } from "@floe-note/domain";
import { useRef } from "react";

import { useDismissibleDetails } from "./useDismissibleDetails.js";

export type SyncUiState =
  | { kind: "quiet" }
  | { kind: "connected" }
  | { kind: "offline" }
  | { kind: "connecting" }
  | { kind: "reconnecting" }
  | { kind: "error"; detail?: string };

export type SyncDeviceUi = {
  deviceId: DeviceId;
  name: string;
  state: "this-device" | "connected" | "online";
};

type SyncStatusProps = {
  state: SyncUiState;
  devices: readonly SyncDeviceUi[];
  onManageDevices: () => void;
};

const COPY: Record<
  Exclude<SyncUiState["kind"], "error">,
  { label: string; description: string }
> = {
  quiet: {
    label: "Local",
    description: "Changes are saved on this device.",
  },
  connected: {
    label: "Connected",
    description: "Other devices are connected and changes can sync directly.",
  },
  offline: {
    label: "Offline",
    description:
      "Changes are saved on this device. Floe Note will reconnect automatically.",
  },
  connecting: {
    label: "Connecting…",
    description: "Another device is online. Floe Note is connecting securely.",
  },
  reconnecting: {
    label: "Reconnecting…",
    description:
      "Changes are saved on this device while Floe Note reconnects.",
  },
};

function stateLabel(state: SyncDeviceUi["state"]): string {
  switch (state) {
    case "this-device":
      return "This device";
    case "connected":
      return "Connected";
    case "online":
      return "Online";
  }
}

export function SyncStatus({
  state,
  devices,
  onManageDevices,
}: SyncStatusProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(detailsRef);

  const copy =
    state.kind === "error"
      ? {
          label: "Sync issue",
          description:
            state.detail ??
            "Changes are saved on this device. Floe Note will keep trying.",
        }
      : COPY[state.kind];

  const connectedCount = devices.filter(
    (device) => device.state === "connected",
  ).length;
  const label =
    state.kind === "connected" && connectedCount > 0
      ? `${copy.label} · ${connectedCount}`
      : copy.label;

  function openDeviceSettings(): void {
    detailsRef.current?.removeAttribute("open");
    onManageDevices();
  }

  return (
    <details className="sync-status" ref={detailsRef}>
      <summary className="sync-status-summary">
        <span className="status-dot" data-kind={state.kind} aria-hidden="true" />
        <span>{label}</span>
      </summary>
      <div className="sync-status-popover">
        <div className="sync-status-heading">
          <strong>{copy.label}</strong>
          <p>{copy.description}</p>
        </div>

        {devices.length > 0 ? (
          <div className="sync-device-list">
            {devices.map((device) => (
              <div className="sync-device-row" key={device.deviceId}>
                <span
                  className="sync-device-dot"
                  data-state={device.state}
                  aria-hidden="true"
                />
                <div className="sync-device-copy">
                  <strong>{device.name}</strong>
                  <span>{stateLabel(device.state)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <button
          className="sync-manage-devices"
          type="button"
          onClick={openDeviceSettings}
        >
          Manage devices <span aria-hidden="true">→</span>
        </button>
      </div>
    </details>
  );
}
