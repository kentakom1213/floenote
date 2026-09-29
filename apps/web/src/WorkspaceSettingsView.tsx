import type { DeviceId, WorkspaceId } from "@floe-note/domain";
import type { AuthorizedDevice } from "@floe-note/security";
import { useEffect, useState, type ReactNode } from "react";

import { ConfirmDialog } from "./ConfirmDialog.js";

type WorkspaceSettingsViewProps = {
  workspaceId: WorkspaceId;
  workspaceName: string;
  localDeviceId: DeviceId | null;
  authorizedDevices: readonly AuthorizedDevice[] | null;
  onlineDeviceIds: readonly DeviceId[];
  connectedDeviceIds: readonly DeviceId[];
  connectionAttempts: readonly {
    deviceId: DeviceId;
    mode: "direct" | "relay";
  }[];
  securityState: "loading" | "ready" | "error";
  securityError: string | null;
  coordinationState: "checking" | "ready" | "error";
  coordinationError: string | null;
  getDeviceDisplayName: (deviceId: DeviceId) => string | null;
  onRenameWorkspace: (name: string) => void;
  onRemoveWorkspaceFromDevice: () => Promise<void>;
  onAddDevice: () => void;
  onRetrySecurity: () => void;
  onRemoveDevice: (deviceId: DeviceId) => Promise<void>;
  scopeNavigation?: ReactNode;
};

function shortDeviceId(deviceId: DeviceId): string {
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
}

export function WorkspaceSettingsView({
  workspaceId,
  workspaceName,
  localDeviceId,
  authorizedDevices,
  onlineDeviceIds,
  connectedDeviceIds,
  connectionAttempts,
  securityState,
  securityError,
  coordinationState,
  coordinationError,
  getDeviceDisplayName,
  onRenameWorkspace,
  onRemoveWorkspaceFromDevice,
  onAddDevice,
  onRetrySecurity,
  onRemoveDevice,
  scopeNavigation,
}: WorkspaceSettingsViewProps) {
  const online = new Set(onlineDeviceIds);
  const connected = new Set(connectedDeviceIds);
  const attempts = new Map(
    connectionAttempts.map((attempt) => [attempt.deviceId, attempt.mode]),
  );
  const [nameDraft, setNameDraft] = useState(workspaceName);
  const [removeWorkspaceOpen, setRemoveWorkspaceOpen] = useState(false);
  const [removeDeviceId, setRemoveDeviceId] = useState<DeviceId | null>(null);
  const normalizedName = nameDraft.trim();
  const nameChanged =
    normalizedName.length > 0 && normalizedName !== workspaceName;

  useEffect(() => {
    setNameDraft(workspaceName);
  }, [workspaceName]);

  const removeDeviceName = removeDeviceId
    ? getDeviceDisplayName(removeDeviceId) ?? "this device"
    : null;

  async function confirmRemoveDevice(): Promise<void> {
    if (!removeDeviceId) return;
    const deviceId = removeDeviceId;
    await onRemoveDevice(deviceId);
    setRemoveDeviceId(null);
  }

  return (
    <section className="settings-view">
      <header className="settings-header">
        <p className="settings-eyebrow">Settings · Workspace</p>
        <h1>{workspaceName}</h1>
      </header>

      {scopeNavigation}

      <div className="settings-section">
        <h2>Workspace</h2>
        <form
          className="settings-form-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!nameChanged) return;
            onRenameWorkspace(normalizedName);
          }}
        >
          <label className="settings-field">
            <span>Workspace name</span>
            <input
              value={nameDraft}
              maxLength={80}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          <button
            className="settings-primary-action"
            type="submit"
            disabled={!nameChanged}
          >
            Save
          </button>
        </form>
      </div>

      <div className="settings-section" id="workspace-devices">
        <div className="settings-section-heading">
          <div>
            <h2>Devices</h2>
            <p>Devices with access to this Workspace.</p>
          </div>
          <button
            className="settings-primary-action"
            type="button"
            onClick={onAddDevice}
            disabled={
              securityState !== "ready" || coordinationState !== "ready"
            }
          >
            Add device
          </button>
        </div>

        {securityState === "ready" && authorizedDevices ? (
          <>
            {coordinationState !== "ready" ? (
              <div className="project-security-inline-error">
                <p>
                  {coordinationState === "checking"
                    ? "Checking coordinator availability. Cached device authorization remains available locally."
                    : `Coordinator is unavailable. Cached device authorization is shown below, but device changes are temporarily unavailable.${coordinationError ? ` ${coordinationError}` : ""}`}
                </p>
                {coordinationState === "error" ? (
                  <button
                    className="dialog-secondary-button"
                    type="button"
                    onClick={onRetrySecurity}
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="device-list">
            {authorizedDevices.map((device) => {
              const isCurrent = device.deviceId === localDeviceId;
              const isOnline = online.has(device.deviceId);
              const isConnected = connected.has(device.deviceId);
              const connectionMode = attempts.get(device.deviceId);
              const displayName =
                getDeviceDisplayName(device.deviceId) ??
                (isCurrent ? "This device" : "Unnamed device");

              return (
                <div className="device-row" key={device.deviceId}>
                  <div className="device-copy">
                    <div className="device-title-row">
                      <strong>{displayName}</strong>
                      {isCurrent ? (
                        <span className="settings-badge">This device</span>
                      ) : null}
                      <span
                        className="device-status"
                        data-state={
                          isCurrent
                            ? isOnline
                              ? "online"
                              : "offline"
                            : isConnected
                              ? "connected"
                              : isOnline
                                ? "online"
                                : "offline"
                        }
                      >
                        {isCurrent
                          ? isOnline
                            ? "Online"
                            : "Offline"
                          : isConnected
                            ? connectionMode
                              ? `Connected · ${connectionMode === "relay" ? "Relay" : "Direct"}`
                              : "Connected"
                            : isOnline && connectionMode
                              ? `Connecting · ${connectionMode === "relay" ? "Relay" : "Direct"}`
                              : isOnline
                                ? "Online"
                                : "Offline"}
                      </span>
                    </div>
                    <p>{shortDeviceId(device.deviceId)}</p>
                  </div>

                  {!isCurrent ? (
                    <button
                      className="settings-danger-action"
                      type="button"
                      onClick={() => setRemoveDeviceId(device.deviceId)}
                      disabled={coordinationState !== "ready"}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              );
            })}
            </div>
          </>
        ) : securityState === "error" ? (
          <div className="project-security-inline-error">
            <p>
              Device authorization could not be loaded.
              {securityError ? ` ${securityError}` : ""}
            </p>
            <button
              className="dialog-secondary-button"
              type="button"
              onClick={onRetrySecurity}
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="settings-loading">Loading authorized devices…</p>
        )}
      </div>

      <div className="settings-section">
        <h2>Data</h2>
        <div className="settings-copy-block">
          <p>
            Notes are stored on your devices and synchronized directly between
            approved devices when they are online.
          </p>
          <p>
            Workspace data is encrypted with a Workspace key that is separate
            from other Workspaces.
          </p>
        </div>

        <details className="technical-details">
          <summary>Technical details</summary>
          <dl>
            <div>
              <dt>Workspace ID</dt>
              <dd>{workspaceId}</dd>
            </div>
          </dl>
        </details>
      </div>

      <div className="settings-section danger-zone">
        <div className="settings-section-heading">
          <div>
            <h2>Danger zone</h2>
            <p>Local actions that do not affect other devices.</p>
          </div>
        </div>
        <div className="danger-zone-row">
          <div>
            <strong>Remove from this device</strong>
            <p>
              Deletes this Workspace&apos;s local notes, metadata, security state,
              and Workspace keys. This device remains authorized and can rejoin
              later.
            </p>
          </div>
          <button
            className="settings-danger-outline-action"
            type="button"
            onClick={() => setRemoveWorkspaceOpen(true)}
          >
            Remove
          </button>
        </div>
      </div>

      {removeDeviceId ? (
        <ConfirmDialog
          title={`Remove ${removeDeviceName} from this Workspace?`}
          description={
            <p>
              This device will stop receiving future changes. Data already
              stored on it cannot be removed remotely.
            </p>
          }
          confirmLabel="Remove device"
          onConfirm={confirmRemoveDevice}
          onClose={() => setRemoveDeviceId(null)}
        />
      ) : null}

      {removeWorkspaceOpen ? (
        <ConfirmDialog
          title={`Remove ${workspaceName} from this device?`}
          description={
            <p>
              Other devices are not changed. To use this Workspace here again,
              join it again from an authorized device.
            </p>
          }
          confirmLabel="Remove from this device"
          onConfirm={onRemoveWorkspaceFromDevice}
          onClose={() => setRemoveWorkspaceOpen(false)}
        />
      ) : null}
    </section>
  );
}
