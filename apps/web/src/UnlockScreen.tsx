import type { DeviceVaultUiState } from "./DeviceVaultPanel.js";

type UnlockScreenProps = {
  state: DeviceVaultUiState;
  error: string | null;
  onUnlockOrCreate: () => Promise<void>;
};

export function UnlockScreen({
  state,
  error,
  onUnlockOrCreate,
}: UnlockScreenProps) {
  const missing = state === "missing";
  const checking = state === "checking";
  const unlocking = state === "unlocking";

  return (
    <main className="unlock-screen">
      <section className="unlock-card">
        <div className="unlock-mark" aria-hidden="true">
          ◆
        </div>
        <p className="settings-eyebrow">Floe Note</p>
        <h1>{missing ? "Set up this device" : "Unlock Floe Note"}</h1>
        <p className="unlock-copy">
          {missing
            ? "Create a local device identity to keep Project keys protected on this device."
            : "Unlock this device to open your encrypted local Projects."}
        </p>

        {checking ? (
          <p className="settings-loading">Checking this device…</p>
        ) : (
          <button
            className="unlock-primary-action"
            type="button"
            disabled={unlocking}
            onClick={() => void onUnlockOrCreate()}
          >
            {unlocking
              ? "Unlocking…"
              : missing
                ? "Set up this device"
                : state === "error"
                  ? "Try again"
                  : "Unlock Floe Note"}
          </button>
        )}

        {error ? <p className="dialog-error">{error}</p> : null}
      </section>
    </main>
  );
}
