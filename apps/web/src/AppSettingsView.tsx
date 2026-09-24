import type { DeviceId } from "@floe-note/domain";
import { useEffect, useState } from "react";

import {
  useCoordinatorBuildInfo,
  webBuildInfo,
} from "./build-info.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ThemePicker } from "./ThemePicker.js";
import type { ThemePreference } from "./theme.js";
import { testTurnCredentialEndpoint } from "./turn-credentials.js";

type AppSettingsViewProps = {
  theme: ThemePreference;
  coordinatorBaseUrl: string;
  localDeviceId: DeviceId | null;
  localDeviceName: string | null;
  turnCredentialEndpoint: string | null;
  onRenameDevice: (displayName: string) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => void;
  onTurnCredentialEndpointChange: (endpoint: string | null) => void;
  onEraseDevice: () => Promise<void>;
  onBack?: () => void;
  showDeviceControls?: boolean;
  showDangerZone?: boolean;
  emphasizeCoordinatorDetails?: boolean;
};

function shortDeviceId(deviceId: DeviceId): string {
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
}

export function AppSettingsView({
  theme,
  coordinatorBaseUrl,
  localDeviceId,
  localDeviceName,
  turnCredentialEndpoint,
  onRenameDevice,
  onThemeChange,
  onTurnCredentialEndpointChange,
  onEraseDevice,
  onBack,
  showDeviceControls = true,
  showDangerZone = true,
  emphasizeCoordinatorDetails = true,
}: AppSettingsViewProps) {
  const coordinatorBuildInfo = useCoordinatorBuildInfo(coordinatorBaseUrl);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(localDeviceName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [turnDraft, setTurnDraft] = useState(turnCredentialEndpoint ?? "");
  const [turnTesting, setTurnTesting] = useState(false);
  const [turnTestMessage, setTurnTestMessage] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const normalizedName = nameDraft.trim();
  const nameChanged =
    normalizedName.length > 0 && normalizedName !== localDeviceName;
  const normalizedTurnEndpoint = turnDraft.trim();
  const turnEndpointChanged =
    normalizedTurnEndpoint !== (turnCredentialEndpoint ?? "");

  useEffect(() => {
    setNameDraft(localDeviceName ?? "");
  }, [localDeviceName]);

  useEffect(() => {
    setTurnDraft(turnCredentialEndpoint ?? "");
    setTurnTestMessage(null);
    setTurnError(null);
  }, [turnCredentialEndpoint]);

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

  function saveTurnEndpoint(): void {
    if (!turnEndpointChanged || turnTesting) return;
    onTurnCredentialEndpointChange(
      normalizedTurnEndpoint.length > 0 ? normalizedTurnEndpoint : null,
    );
    setTurnTestMessage(null);
    setTurnError(null);
  }

  async function testTurnEndpoint(): Promise<void> {
    if (!normalizedTurnEndpoint || turnTesting) return;

    setTurnTesting(true);
    setTurnTestMessage(null);
    setTurnError(null);
    try {
      await testTurnCredentialEndpoint(normalizedTurnEndpoint);
      setTurnTestMessage("TURN credentials are available.");
    } catch (caught: unknown) {
      setTurnError(
        caught instanceof Error
          ? caught.message
          : "Could not fetch TURN credentials",
      );
    } finally {
      setTurnTesting(false);
    }
  }

  return (
    <section className="settings-view onboarding-settings-view">
      <header className="settings-header">
        {onBack ? (
          <button
            className="onboarding-back-button"
            type="button"
            onClick={onBack}
          >
            ← Back
          </button>
        ) : null}
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
        <h2>This device</h2>
        {showDeviceControls ? (
          <>
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
          </>
        ) : (
          <p className="settings-device-placeholder">
            Security will be configured when you create, join, or import a
            Project.
          </p>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>Network</h2>
            <p>Configure optional relay connectivity for this device.</p>
          </div>
        </div>
        <div className="settings-form-row">
          <label className="settings-field">
            <span>TURN credential endpoint</span>
            <input
              type="url"
              value={turnDraft}
              disabled={turnTesting}
              placeholder="https://floe-note-turn.example.workers.dev/credentials/…"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setTurnDraft(event.target.value);
                setTurnTestMessage(null);
                setTurnError(null);
              }}
            />
          </label>
          <div className="settings-form-actions">
            <button
              className="settings-primary-action"
              type="button"
              disabled={!normalizedTurnEndpoint || turnTesting}
              onClick={() => void testTurnEndpoint()}
            >
              {turnTesting ? "Testing…" : "Test"}
            </button>
            <button
              className="settings-primary-action"
              type="button"
              disabled={!turnEndpointChanged || turnTesting}
              onClick={saveTurnEndpoint}
            >
              Save
            </button>
          </div>
        </div>
        <p className="settings-field-hint">
          Optional and stored only on this device. All Projects on this device
          use it as an ICE relay fallback when direct WebRTC connectivity is
          unavailable. Treat the endpoint URL as a secret.
        </p>
        {turnTestMessage ? (
          <p className="turn-test-status" data-state="success">✓ {turnTestMessage}</p>
        ) : null}
        {turnError ? <p className="turn-test-status" data-state="error">× {turnError}</p> : null}
      </div>

      <div className="settings-section">
        <h2>About</h2>
        <div className="settings-copy-block">
          <p>
            Floe Note is a local-first note app. Project data stays on your
            devices and synchronizes directly between authorized devices when
            they are online.
          </p>
          <p>Each Project has its own access boundary and encryption key.</p>
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
            {emphasizeCoordinatorDetails ? (
              <>
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
              </>
            ) : null}
          </dl>
        </details>
      </div>

      {showDangerZone ? (
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
      ) : null}

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
