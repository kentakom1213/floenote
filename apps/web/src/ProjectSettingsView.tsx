import type { DeviceId, ProjectId } from "@floe-note/domain";
import type { AuthorizedDevice } from "@floe-note/security";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog.js";

type ProjectSettingsViewProps = {
  projectId: ProjectId;
  projectName: string;
  localDeviceId: DeviceId;
  authorizedDevices: readonly AuthorizedDevice[];
  onlineDeviceIds: readonly DeviceId[];
  connectedDeviceIds: readonly DeviceId[];
  getDeviceDisplayName: (deviceId: DeviceId) => string | null;
  onRenameProject: (name: string) => void;
  onRemoveProjectFromDevice: () => Promise<void>;
  onAddDevice: () => void;
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
  getDeviceDisplayName,
  onRenameProject,
  onRemoveProjectFromDevice,
  onAddDevice,
  onRemoveDevice,
}: ProjectSettingsViewProps) {
  const online = new Set(onlineDeviceIds);
  const connected = new Set(connectedDeviceIds);
  const [nameDraft, setNameDraft] = useState(projectName);
  const [removeProjectOpen, setRemoveProjectOpen] = useState(false);
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

      <div className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>Devices</h2>
            <p>Devices with access to this Project.</p>
          </div>
          <button
            className="settings-primary-action"
            type="button"
            onClick={onAddDevice}
          >
            Add device
          </button>
        </div>

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
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
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
          onConfirm={async () => {
            await onRemoveDevice(removeDeviceId);
            setRemoveDeviceId(null);
          }}
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
