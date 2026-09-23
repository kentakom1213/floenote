import { useEffect, useState } from "react";

import type { DeviceVaultUiState } from "./DeviceVaultPanel.js";
import { generateDeviceDisplayName } from "./device-name.js";

type UnlockScreenProps = {
  state: DeviceVaultUiState;
  error: string | null;
  onUnlock: () => Promise<void>;
  onCreateWithExistingPasskey: (displayName: string) => Promise<void>;
  onCreateWithNewPasskey: (displayName: string) => Promise<void>;
  onResetDevice: () => Promise<void>;
};

export function UnlockScreen({
  state,
  error,
  onUnlock,
  onCreateWithExistingPasskey,
  onCreateWithNewPasskey,
  onResetDevice,
}: UnlockScreenProps) {
  const [displayName, setDisplayName] = useState(generateDeviceDisplayName);
  const [setupMode, setSetupMode] = useState(state === "missing");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (state === "missing") setSetupMode(true);
  }, [state]);

  const checking = state === "checking";
  const unlocking = state === "unlocking";
  const canSubmit = displayName.trim().length > 0;

  async function resetDevice(): Promise<void> {
    const confirmed = window.confirm(
      "Reset this device? This deletes the local Device Vault and all local Project data. You will need another authorized device to join those Projects again.",
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
          {setupMode ? (
            <>
              <p className="unlock-tagline">Your notes, on your devices.</p>
              <p className="unlock-product-copy">
                Floe Note is a local-first notebook that syncs securely between
                your devices.
              </p>
            </>
          ) : null}
        </header>

        <div className="unlock-flow">
          <h1>{setupMode ? "Set up this device" : "Unlock Floe Note"}</h1>
          <p className="unlock-copy">
            {setupMode
              ? "Create a device identity to get started."
              : "Unlock this device to open your encrypted local Projects."}
          </p>

          {setupMode ? (
            <>
              <label className="unlock-field">
                <span>Device name</span>
                <input
                  autoFocus
                  maxLength={80}
                  value={displayName}
                  disabled={unlocking}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>

              <div className="unlock-setup-actions">
                <button
                  className="unlock-primary-action"
                  type="button"
                  disabled={unlocking || !canSubmit}
                  onClick={() =>
                    void onCreateWithExistingPasskey(displayName.trim())
                  }
                >
                  {unlocking ? "Waiting for passkey…" : "Use existing passkey"}
                </button>
                <button
                  className="unlock-secondary-action"
                  type="button"
                  disabled={unlocking || !canSubmit}
                  onClick={() =>
                    void onCreateWithNewPasskey(displayName.trim())
                  }
                >
                  Create new passkey
                </button>
              </div>
            </>
          ) : checking ? (
            <p className="settings-loading">Checking this device…</p>
          ) : (
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
          )}

          {error ? <p className="dialog-error">{error}</p> : null}

          {!setupMode && state === "error" ? (
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
