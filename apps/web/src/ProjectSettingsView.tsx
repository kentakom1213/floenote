import type { DeviceId, ProjectId } from "@floe-note/domain";
import type { AuthorizedDevice } from "@floe-note/security";

type ProjectSettingsViewProps = {
  projectId: ProjectId;
  projectName: string;
  localDeviceId: DeviceId;
  authorizedDevices: readonly AuthorizedDevice[];
  onlineDeviceIds: readonly DeviceId[];
  connectedDeviceIds: readonly DeviceId[];
  onAddDevice: () => void;
  onRemoveDevice: (deviceId: DeviceId) => void;
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
  onAddDevice,
  onRemoveDevice,
}: ProjectSettingsViewProps) {
  const online = new Set(onlineDeviceIds);
  const connected = new Set(connectedDeviceIds);

  return (
    <section className="settings-view">
      <header className="settings-header">
        <p className="settings-eyebrow">Project settings</p>
        <h1>{projectName}</h1>
      </header>

      <div className="settings-section">
        <h2>General</h2>
        <div className="settings-row">
          <div>
            <strong>Project name</strong>
            <p>{projectName}</p>
          </div>
        </div>
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

            return (
              <div className="device-row" key={device.deviceId}>
                <div className="device-copy">
                  <div className="device-title-row">
                    <strong>{isCurrent ? "This device" : "Device"}</strong>
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
                    onClick={() => onRemoveDevice(device.deviceId)}
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
    </section>
  );
}
