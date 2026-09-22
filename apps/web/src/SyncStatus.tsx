import { useRef } from "react";

import { useDismissibleDetails } from "./useDismissibleDetails.js";

export type SyncUiState =
  | { kind: "quiet" }
  | { kind: "connected" }
  | { kind: "offline" }
  | { kind: "connecting" }
  | { kind: "reconnecting" }
  | { kind: "error"; detail?: string };

type SyncStatusProps = {
  state: SyncUiState;
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
    description: "Another device is connected and changes can sync directly.",
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

export function SyncStatus({ state }: SyncStatusProps) {
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

  return (
    <details className="sync-status" ref={detailsRef}>
      <summary className="sync-status-summary">
        <span className="status-dot" data-kind={state.kind} aria-hidden="true" />
        <span>{copy.label}</span>
      </summary>
      <div className="sync-status-popover">
        <strong>{copy.label}</strong>
        <p>{copy.description}</p>
      </div>
    </details>
  );
}
