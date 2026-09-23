import type { DeviceId, ProjectId } from "@floe-note/domain";
import type { AuthorizedDevice } from "@floe-note/security";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog.js";

type ProjectSettingsViewProps = {
  projectId: ProjectId;
  projectName: string;
  localDeviceId: DeviceId | null;
  authorizedDevices: readonly AuthorizedDevice[] | null;
  onlineDeviceIds: readonly DeviceId[];
  connectedDeviceIds: readonly DeviceId[];
  securityState: "loading" | "ready" | "error";
  securityError: string | null;
  coordinationState: "checking" | "ready" | "error";
  coordinationError: string | null;
  getDeviceDisplayName: (deviceId: DeviceId) => string | null;
  onRenameProject: (name: string) => void;
  onExportProject: () => Promise<void>;
  onRemoveProjectFromDevice: () => Promise<void>;
  onAddDevice: () => void;
  onRetrySecurity: () => void;
  onRemoveDevice: (deviceId: DeviceId) => Promise<void>;
};

function shortDeviceId(deviceId: DeviceId): string {
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
}

export function ProjectSettingsView({
  projectId,
  projectName,
  localDeviceId,
  authorizedDevices,
  onlineDeviceIds,
  connectedDeviceIds,
  securityState,
  securityError,
  coordinationState,
  coordinationError,
  getDeviceDisplayName,
  onRenameProject,
  onExportProject,
  onRemoveProjectFromDevice,
  onAddDevice,
  onRetrySecurity,
  onRemoveDevice,
}: ProjectSettingsViewProps) {
  const online = new Set(onlineDeviceIds);
  const connected = new Set(connectedDeviceIds);
  const [nameDraft, setNameDraft] = useState(projectName);
  const [removeProjectOpen, setRemoveProjectOpen] = useState(false);
  const [exportState, setExportState] = useState<
    "idle" | "exporting" | "success" | "error"
  >("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [removeDeviceId, setRemoveDeviceId] = useState<DeviceId | null>(null);
  const normalizedName = nameDraft.trim();
  const nameChanged =
    normalizedName.length > 0 && normalizedName !== projectName;

  useEffect(() => {
    setNameDraft(projectName);
  }, [projectName]);

  const removeDeviceName = removeDeviceId
    ? getDeviceDisplayName(removeDeviceId) ?? "this device"
    : null;

  async function exportProject(): Promise<void> {
    if (exportState === "exporting") return;

    setExportState("exporting");
    setExportError(null);

    try {
      await onExportProject();
      setExportState("success");
    } catch (error: unknown) {
      setExportState("error");
      setExportError(
        error instanceof Error ? error.message : "Failed to export Project",
      );
    }
  }

  async function confirmRemoveDevice(): Promise<void> {
    if (!removeDeviceId) return;
    const deviceId = removeDeviceId;
    await onRemoveDevice(deviceId);
    setRemoveDeviceId(null);
  }

  return (
    <section className="settings-view">
      <header className="settings-header">
        <p className="settings-eyebrow">Project settings</p>
        <h1>{projectName}</h1>
      </header>

      <div className="settings-section">
        <h2>General</h2>
        <form
          className="settings-form-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!nameChanged) return;
            onRenameProject(normalizedName);
          }}
        >
          <label className="settings-field">
            <span>Project name</span>
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

      <div className="settings-section" id="project-devices">
        <div className="settings-section-heading">
          <div>
            <h2>Devices</h2>
            <p>Devices with access to this Project.</p>
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
                            ? "Connected"
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
        <h2>Data &amp; security</h2>
        <div className="settings-copy-block">
          <p>
            Notes are stored on your devices and synchronized directly between
            approved devices when they are online.
          </p>
          <p>
            Project data is encrypted with a Project key that is separate from
            other Projects.
          </p>
        </div>

        <div className="settings-row settings-row-spread project-export-row">
          <div className="project-export-copy">
            <strong>Export Project</strong>
            <p>
              Export the notes and metadata currently available on this device
              as portable Markdown and JSON. Encryption keys, device
              authorization, and synchronization state are not included.
            </p>
            <p className="project-export-warning">
              The exported file is not encrypted. It is a local snapshot from
              this device, not a backup of every peer.
            </p>
            {exportState === "success" ? (
              <p className="project-export-status" role="status">
                Export downloaded.
              </p>
            ) : exportState === "error" ? (
              <p className="project-export-error" role="alert">
                Export failed.{exportError ? ` ${exportError}` : ""}
              </p>
            ) : null}
          </div>
          <button
            className="settings-primary-action"
            type="button"
            onClick={() => void exportProject()}
            disabled={exportState === "exporting"}
          >
            {exportState === "exporting" ? "Exporting…" : "Export"}
          </button>
        </div>

        <details className="technical-details">
          <summary>Technical details</summary>
          <dl>
            <div>
              <dt>Project ID</dt>
              <dd>{projectId}</dd>
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
              Deletes this Project&apos;s local notes, metadata, SecurityState,
              and Project keys. This device remains authorized and can rejoin
              later.
            </p>
          </div>
          <button
            className="settings-danger-outline-action"
            type="button"
            onClick={() => setRemoveProjectOpen(true)}
          >
            Remove
          </button>
        </div>
      </div>

      {removeDeviceId ? (
        <ConfirmDialog
          title={`Remove ${removeDeviceName} from this Project?`}
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

      {removeProjectOpen ? (
        <ConfirmDialog
          title={`Remove ${projectName} from this device?`}
          description={
            <p>
              Other devices are not changed. To use this Project here again,
              join it again from an authorized device.
            </p>
          }
          confirmLabel="Remove from this device"
          onConfirm={onRemoveProjectFromDevice}
          onClose={() => setRemoveProjectOpen(false)}
        />
      ) : null}
    </section>
  );
}
