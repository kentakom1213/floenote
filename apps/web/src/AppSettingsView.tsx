import type { DeviceId } from "@floe-note/domain";

import { ThemePicker } from "./ThemePicker.js";
import type { ThemePreference } from "./theme.js";

type AppSettingsViewProps = {
  theme: ThemePreference;
  localDeviceId: DeviceId | null;
  onThemeChange: (theme: ThemePreference) => void;
};

function shortDeviceId(deviceId: DeviceId): string {
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
}

export function AppSettingsView({
  theme,
  localDeviceId,
  onThemeChange,
}: AppSettingsViewProps) {
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
    </section>
  );
}
