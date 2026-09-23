import type { DeviceId } from "@floe-note/domain";
import { useEffect, useState } from "react";

import {
  useCoordinatorBuildInfo,
  webBuildInfo,
} from "./build-info.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ThemePicker } from "./ThemePicker.js";
import type { ThemePreference } from "./theme.js";

type AppSettingsViewProps = {
  theme: ThemePreference;
  coordinatorBaseUrl: string;
  localDeviceId: DeviceId | null;
  localDeviceName: string | null;
  onRenameDevice: (displayName: string) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => void;
  onEraseDevice: () => Promise<void>;
};

function shortDeviceId(deviceId: DeviceId): string {
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
}

export function AppSettingsView({
  theme,
  coordinatorBaseUrl,
  localDeviceId,
  localDeviceName,
  onRenameDevice,
  onThemeChange,
  onEraseDevice,
}: AppSettingsViewProps) {
  const coordinatorBuildInfo = useCoordinatorBuildInfo(coordinatorBaseUrl);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(localDeviceName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const normalizedName = nameDraft.trim();
  const nameChanged =
    normalizedName.length > 0 && normalizedName !== localDeviceName;

  useEffect(() => {
    setNameDraft(localDeviceName ?? "");
  }, [localDeviceName]);

  async function saveDeviceName(): Promise<void> {
    if (!nameChanged || savingName) return;

    setSavingName(true);
    setNameError(null);
    try {
      await onRenameDevice(normalizedName);
    } catch (caught: unknown) {
      setNameError(
        caught instanceof Error ? caught.message : "Could not rename device",
      );
    } finally {
      setSavingName(false);
    }
  }

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
        <form
          className="settings-form-row"
          onSubmit={(event) => {
            event.preventDefault();
            void saveDeviceName();
          }}
        >
          <label className="settings-field">
            <span>Device name</span>
            <input
              value={nameDraft}
              maxLength={80}
              disabled={savingName}
              placeholder="Kenta's MacBook"
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          <button
            className="settings-primary-action"
            type="submit"
            disabled={!nameChanged || savingName}
          >
            {savingName ? "Saving…" : "Save"}
          </button>
        </form>
        <p className="settings-field-hint">
          This name is stored in the Device Vault and shared only inside
          Projects you use.
        </p>
        {nameError ? <p className="dialog-error">{nameError}</p> : null}

        {localDeviceId ? (
          <details className="technical-details">
            <summary>Technical details</summary>
            <dl>
              <div>
                <dt>Device ID</dt>
                <dd>{localDeviceId}</dd>
              </div>
              <div>
                <dt>Short ID</dt>
                <dd>{shortDeviceId(localDeviceId)}</dd>
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

        <details className="technical-details">
          <summary>Technical details</summary>
          <dl>
            <div>
              <dt>Web version</dt>
              <dd>{webBuildInfo.version}</dd>
            </div>
            <div>
              <dt>Web build</dt>
              <dd>{webBuildInfo.build}</dd>
            </div>
            <div>
              <dt>Coordinator version</dt>
              <dd>
                {coordinatorBuildInfo.status === "checking"
                  ? "Checking…"
                  : coordinatorBuildInfo.status === "available"
                    ? coordinatorBuildInfo.info.version
                    : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Coordinator build</dt>
              <dd>
                {coordinatorBuildInfo.status === "checking"
                  ? "Checking…"
                  : coordinatorBuildInfo.status === "available"
                    ? coordinatorBuildInfo.info.build
                    : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Coordinator URL</dt>
              <dd>{coordinatorBaseUrl}</dd>
            </div>
          </dl>
        </details>
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
