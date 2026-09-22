import type { DeviceId } from "@floe-note/domain";

export type DeviceVaultUiState =
  | "checking"
  | "missing"
  | "locked"
  | "unlocking"
  | "unlocked"
  | "error";

export type LocalSecurityBootstrapUiState =
  | "waiting"
  | "committing"
  | "committed"
  | "error";

type DeviceVaultPanelProps = {
  state: DeviceVaultUiState;
  deviceId: DeviceId | null;
  error: string | null;
  securityState: LocalSecurityBootstrapUiState;
  securityHeadHash: string | null;
  securitySequence: number | null;
  securityKeyEpoch: number | null;
  securityDeviceCount: number | null;
  securityError: string | null;
  onUnlockOrCreate: () => Promise<void>;
};

export function DeviceVaultPanel({
  state,
  deviceId,
  error,
  securityState,
  securityHeadHash,
  securitySequence,
  securityKeyEpoch,
  securityDeviceCount,
  securityError,
  onUnlockOrCreate,
}: DeviceVaultPanelProps) {
  const buttonLabel =
    state === "missing"
      ? "Initialize device"
      : state === "unlocking"
        ? "Unlocking…"
        : "Unlock device";

  return (
    <section className="webrtc-debug-panel">
      <p className="eyebrow">Device Vault</p>
      <p className="webrtc-status">
        State: <strong>{state}</strong>
      </p>
      {deviceId ? (
        <p className="webrtc-status">
          Device ID: <strong>{deviceId}</strong>
        </p>
      ) : null}

      {state !== "unlocked" && state !== "checking" ? (
        <button
          type="button"
          onClick={() => void onUnlockOrCreate()}
          disabled={state === "unlocking"}
        >
          {buttonLabel}
        </button>
      ) : null}

      {error ? <p className="webrtc-error">{error}</p> : null}

      {state === "unlocked" ? (
        <>
          <p className="webrtc-status">
            Security: <strong>{securityState}</strong>
          </p>
          {securityState === "committed" ? (
            <>
              <p className="webrtc-status">
                Sequence: <strong>{securitySequence}</strong>
              </p>
              <p className="webrtc-status">
                Key epoch: <strong>{securityKeyEpoch}</strong>
              </p>
              <p className="webrtc-status">
                Devices: <strong>{securityDeviceCount}</strong>
              </p>
            </>
          ) : null}
          {securityHeadHash ? (
            <p className="webrtc-status">
              Initial head: <strong>{securityHeadHash}</strong>
            </p>
          ) : null}
          {securityError ? (
            <p className="webrtc-error">{securityError}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
