import type { DeviceId } from "@floe-note/domain";
import type { AuthorizedDevice } from "@floe-note/security";
import type { AuthorizedPresenceConnectionState } from "@floe-note/coordinator-client";

type AuthorizedDevicesPanelProps = {
  state: AuthorizedPresenceConnectionState;
  localDeviceId: DeviceId;
  authorizedDevices: readonly AuthorizedDevice[];
  onlineDeviceIds: readonly DeviceId[];
  connectedDeviceIds: readonly DeviceId[];
  error: string | null;
  onRevoke: (deviceId: DeviceId) => void;
};

export function AuthorizedDevicesPanel({
  state,
  localDeviceId,
  authorizedDevices,
  onlineDeviceIds,
  connectedDeviceIds,
  error,
  onRevoke,
}: AuthorizedDevicesPanelProps) {
  const online = new Set<DeviceId>(onlineDeviceIds);
  const connected = new Set<DeviceId>(connectedDeviceIds);

  return (
    <section className="webrtc-debug-panel">
      <p className="eyebrow">Authorized devices</p>
      <p className="webrtc-status">
        Presence: <strong>{state}</strong>
      </p>

      {authorizedDevices.map((device) => (
        <div className="webrtc-status" key={device.deviceId}>
          <strong>
            {device.deviceId}
            {device.deviceId === localDeviceId ? " (this device)" : ""}
          </strong>
          {" — "}
          {device.deviceId === localDeviceId
            ? online.has(device.deviceId)
              ? "online"
              : "offline"
            : online.has(device.deviceId)
              ? connected.has(device.deviceId)
                ? "online · sync connected"
                : "online · sync pending"
              : "offline"}
          {device.deviceId !== localDeviceId ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => onRevoke(device.deviceId)}
              >
                Revoke
              </button>
            </>
          ) : null}
        </div>
      ))}

      {error ? <p className="webrtc-error">{error}</p> : null}
    </section>
  );
}
