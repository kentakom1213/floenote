import { useState } from "react";

import type { DeviceVaultUiState } from "./DeviceVaultPanel.js";

type UnlockScreenProps = {
  state: DeviceVaultUiState;
  error: string | null;
  onUnlock: () => Promise<void>;
  onResetDevice: () => Promise<void>;
};

export function UnlockScreen({
  state,
  error,
  onUnlock,
  onResetDevice,
}: UnlockScreenProps) {
  const [resetting, setResetting] = useState(false);
  const unlocking = state === "unlocking";

  async function resetDevice(): Promise<void> {
    const confirmed = window.confirm(
      "Reset this device? This deletes the local Device Vault and all local Workspace data. You will need another authorized device to join those Workspaces again.",
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      await onResetDevice();
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="unlock-screen">
      <section className="unlock-card">
        <header className="unlock-brand">
          <img
            className="unlock-logo"
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
          />
          <p className="settings-eyebrow">Floe Note</p>
        </header>

        <div className="unlock-flow">
          <h1>Unlock Floe Note</h1>
          <p className="unlock-copy">
            Unlock this device to open your encrypted local Workspaces.
          </p>

          <button
            className="unlock-primary-action"
            type="button"
            disabled={unlocking || resetting}
            onClick={() => void onUnlock()}
          >
            {unlocking
              ? "Unlocking…"
              : state === "error"
                ? "Try again"
                : "Unlock Floe Note"}
          </button>

          {error ? <p className="dialog-error">{error}</p> : null}

          {state === "error" ? (
            <div className="unlock-reset">
              <p>
                If this passkey was deleted or is no longer available, this
                local Vault cannot be recovered in v1.
              </p>
              <button
                type="button"
                disabled={resetting || unlocking}
                onClick={() => void resetDevice()}
              >
                {resetting ? "Resetting…" : "Reset this device"}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
