import { useState } from "react";

import { generateDeviceDisplayName } from "./device-name.js";

type SecureDeviceStepProps = {
  busy: boolean;
  error: string | null;
  onCreateWithExistingPasskey: (displayName: string) => Promise<void>;
  onCreateWithNewPasskey: (displayName: string) => Promise<void>;
  onBack: () => void;
};

export function SecureDeviceStep({
  busy,
  error,
  onCreateWithExistingPasskey,
  onCreateWithNewPasskey,
  onBack,
}: SecureDeviceStepProps) {
  const [displayName, setDisplayName] = useState(generateDeviceDisplayName);
  const canSubmit = displayName.trim().length > 0;

  return (
    <main className="unlock-screen onboarding-secure-screen">
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
          <button
            className="onboarding-back-button"
            type="button"
            disabled={busy}
            onClick={onBack}
          >
            ← Back
          </button>
          <h1>Secure this device</h1>
          <p className="unlock-copy">
            Floe Note uses a passkey to protect the encryption keys stored on
            this device.
          </p>

          <label className="unlock-field">
            <span>Device name</span>
            <input
              autoFocus
              maxLength={80}
              value={displayName}
              disabled={busy}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>

          <div className="unlock-setup-actions">
            <button
              className="unlock-primary-action"
              type="button"
              disabled={busy || !canSubmit}
              onClick={() =>
                void onCreateWithExistingPasskey(displayName.trim())
              }
            >
              {busy ? "Waiting for passkey…" : "Use existing passkey"}
            </button>
            <button
              className="unlock-secondary-action"
              type="button"
              disabled={busy || !canSubmit}
              onClick={() =>
                void onCreateWithNewPasskey(displayName.trim())
              }
            >
              Create new passkey
            </button>
          </div>

          {error ? <p className="dialog-error">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
