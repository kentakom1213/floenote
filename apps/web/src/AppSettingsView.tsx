import type { DeviceId } from "@floe-note/domain";
import { useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog.js";
import { ThemePicker } from "./ThemePicker.js";
import type { ThemePreference } from "./theme.js";

type AppSettingsViewProps = {
  theme: ThemePreference;
  localDeviceId: DeviceId | null;
  onThemeChange: (theme: ThemePreference) => void;
  onEraseDevice: () => Promise<void>;
};

function shortDeviceId(deviceId: DeviceId): string {
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
}

export function AppSettingsView({
  theme,
  localDeviceId,
  onThemeChange,
  onEraseDevice,
}: AppSettingsViewProps) {
  const [eraseOpen, setEraseOpen] = useState(false);
  return (
    <section className="settings-view">
      <header className="settings-header">
        <p className="settings-eyebrow">Floe Note</p>
        <h1>Settings</h1>
      </header>

      <div className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>Appearance</h2>
            <p>Choose how Floe Note looks on this device.</p>
          </div>
        </div>
        <ThemePicker value={theme} onChange={onThemeChange} />
      </div>

      <div className="settings-section">
        <h2>Current device</h2>
        <div className="settings-row settings-row-spread">
          <div>
            <strong>This device</strong>
            <p>
              {localDeviceId
                ? shortDeviceId(localDeviceId)
                : "Device identity unavailable"}
            </p>
          </div>
          <span className="settings-badge">Device Vault</span>
        </div>

        {localDeviceId ? (
          <details className="technical-details">
            <summary>Technical details</summary>
            <dl>
              <div>
                <dt>Device ID</dt>
                <dd>{localDeviceId}</dd>
              </div>
            </dl>
          </details>
        ) : null}
      </div>

      <div className="settings-section">
        <h2>About</h2>
        <div className="settings-copy-block">
          <p>
            Floe Note is a local-first note app. Project data stays on your
            devices and synchronizes directly between authorized devices when
            they are online.
          </p>
          <p>
            Each Project has its own access boundary and encryption key.
          </p>
        </div>
      </div>

      <div className="settings-section danger-zone">
        <div className="settings-section-heading">
          <div>
            <h2>Danger zone</h2>
            <p>Remove all Floe Note data stored by this app on this device.</p>
          </div>
        </div>
        <div className="danger-zone-row">
          <div>
            <strong>Erase Floe Note from this device</strong>
            <p>
              Removes local Projects, notes, SecurityState, Device Vault keys,
              Project keys, and Floe Note preferences. Other devices are not
              changed.
            </p>
          </div>
          <button
            className="settings-danger-outline-action"
            type="button"
            onClick={() => setEraseOpen(true)}
          >
            Erase local data
          </button>
        </div>
        <p className="danger-zone-note">
          A WebAuthn credential may remain in your browser or password manager
          and can be removed there separately.
        </p>
      </div>

      {eraseOpen ? (
        <ConfirmDialog
          title="Erase Floe Note from this device?"
          description={
            <>
              <p>
                This removes all Floe Note data stored by this app on this
                device. It does not remove data from other devices or revoke
                this Device ID from Projects.
              </p>
              <p>This action cannot be undone locally.</p>
            </>
          }
          confirmLabel="Erase local data"
          confirmationPhrase="ERASE"
          onConfirm={onEraseDevice}
          onClose={() => setEraseOpen(false)}
        />
      ) : null}
    </section>
  );
}
