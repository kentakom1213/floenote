import { useEffect, useState } from "react";

import type { DeviceVaultUiState } from "./DeviceVaultPanel.js";

type UnlockScreenProps = {
  state: DeviceVaultUiState;
  error: string | null;
  onUnlockOrCreate: (displayName?: string) => Promise<void>;
};

export function UnlockScreen({
  state,
  error,
  onUnlockOrCreate,
}: UnlockScreenProps) {
  const [displayName, setDisplayName] = useState("");
  const [setupMode, setSetupMode] = useState(state === "missing");

  useEffect(() => {
    if (state === "missing") setSetupMode(true);
  }, [state]);

  const checking = state === "checking";
  const unlocking = state === "unlocking";
  const canSubmit = !setupMode || displayName.trim().length > 0;

  return (
    <main className="unlock-screen">
      <section className="unlock-card">
        <div className="unlock-mark" aria-hidden="true">
          ◆
        </div>
        <p className="settings-eyebrow">Floe Note</p>
        <h1>{setupMode ? "Set up this device" : "Unlock Floe Note"}</h1>
        <p className="unlock-copy">
          {setupMode
            ? "Create a local device identity and give this device a name you will recognize on your other devices."
            : "Unlock this device to open your encrypted local Projects."}
        </p>

        {setupMode ? (
          <label className="unlock-field">
            <span>Device name</span>
            <input
              autoFocus
              maxLength={80}
              value={displayName}
              placeholder="Kenta's MacBook"
              disabled={unlocking}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        ) : null}

        {checking ? (
          <p className="settings-loading">Checking this device…</p>
        ) : (
          <button
            className="unlock-primary-action"
            type="button"
            disabled={unlocking || !canSubmit}
            onClick={() =>
              void onUnlockOrCreate(
                setupMode ? displayName.trim() : undefined,
              )
            }
          >
            {unlocking
              ? "Unlocking…"
              : setupMode
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
