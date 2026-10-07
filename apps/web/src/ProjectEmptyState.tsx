import type { DeviceId } from "@floe-note/domain";
import { useState } from "react";

import { AppSettingsView } from "./AppSettingsView.js";
import type { DeviceVaultUiState } from "./DeviceVaultPanel.js";
import { parseInvitationUrl } from "./invitation-url.js";
import { Modal } from "./Modal.js";
import {
  actionRequiresSecureDevice,
  type OnboardingAction,
} from "./onboarding-state.js";
import { SecureDeviceStep } from "./SecureDeviceStep.js";
import type { ThemePreference } from "./theme.js";

type ProjectEmptyStateProps = {
  vaultState: DeviceVaultUiState;
  vaultError: string | null;
  theme: ThemePreference;
  coordinatorBaseUrl: string;
  localDeviceId: DeviceId | null;
  localDeviceName: string | null;
  turnCredentialEndpoint: string | null;
  onCreateWithExistingPasskey: (displayName: string) => Promise<void>;
  onCreateWithNewPasskey: (displayName: string) => Promise<void>;
  onRenameDevice: (displayName: string) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => void;
  onTurnCredentialEndpointChange: (endpoint: string | null) => void;
  onEraseDevice: () => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
  onImportFloeExport: (archive: Uint8Array) => Promise<void>;
  onImportMarkdownDirectory: (files: readonly File[]) => Promise<void>;
};

type OnboardingView = "entry" | "settings" | "secure";
const DEFAULT_WORKSPACE_NAME = "Personal";

export function ProjectEmptyState({
  vaultState,
  vaultError,
  theme,
  coordinatorBaseUrl,
  localDeviceId,
  localDeviceName,
  turnCredentialEndpoint,
  onCreateWithExistingPasskey,
  onCreateWithNewPasskey,
  onRenameDevice,
  onThemeChange,
  onTurnCredentialEndpointChange,
  onEraseDevice,
  onCreateProject,
  onImportFloeExport,
  onImportMarkdownDirectory,
}: ProjectEmptyStateProps) {
  const [view, setView] = useState<OnboardingView>("entry");
  const [pendingAction, setPendingAction] = useState<OnboardingAction | null>(
    null,
  );
  const [joinOpen, setJoinOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [markdownImportOpen, setMarkdownImportOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAction(action: OnboardingAction): void {
    if (action === "create") void createDefaultWorkspace();
    if (action === "import-floe") setImportOpen(true);
    if (action === "import-markdown") setMarkdownImportOpen(true);
  }

  function chooseAction(action: OnboardingAction): void {
    setError(null);
    if (actionRequiresSecureDevice(action, vaultState)) {
      setPendingAction(action);
      setView("secure");
      return;
    }
    openAction(action);
  }

  async function secureDevice(
    create: (displayName: string) => Promise<void>,
    displayName: string,
  ): Promise<void> {
    if (busy || !pendingAction) return;

    setBusy(true);
    setError(null);
    try {
      await create(displayName);
      const action = pendingAction;
      setPendingAction(null);
      setView("entry");
      if (action === "create") {
        await onCreateProject(DEFAULT_WORKSPACE_NAME);
      } else {
        openAction(action);
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not secure this device",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createDefaultWorkspace(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await onCreateProject(DEFAULT_WORKSPACE_NAME);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not create Workspace",
      );
    } finally {
      setBusy(false);
    }
  }

  function joinProject(): void {
    if (busy) return;

    setError(null);
    try {
      const url = parseInvitationUrl(inviteUrl, window.location.origin);
      setBusy(true);
      window.location.assign(url.toString());
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Invalid invitation link",
      );
    }
  }

  async function importFloeExport(file: File): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const archive = new Uint8Array(await file.arrayBuffer());
      await onImportFloeExport(archive);
      setImportOpen(false);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not import Floe export",
      );
    } finally {
      setBusy(false);
    }
  }

  async function importMarkdownDirectory(
    files: readonly File[],
  ): Promise<void> {
    if (busy || files.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      await onImportMarkdownDirectory(files);
      setMarkdownImportOpen(false);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not import Markdown directory",
      );
    } finally {
      setBusy(false);
    }
  }

  function closeDialogs(): void {
    if (busy) return;
    setJoinOpen(false);
    setImportOpen(false);
    setMarkdownImportOpen(false);
    setInviteUrl("");
    setError(null);
  }

  if (view === "settings") {
    return (
      <main className="project-empty-screen onboarding-settings-screen">
        <AppSettingsView
          theme={theme}
          coordinatorBaseUrl={coordinatorBaseUrl}
          localDeviceId={localDeviceId}
          localDeviceName={localDeviceName}
          turnCredentialEndpoint={turnCredentialEndpoint}
          onRenameDevice={onRenameDevice}
          onThemeChange={onThemeChange}
          onTurnCredentialEndpointChange={onTurnCredentialEndpointChange}
          onEraseDevice={onEraseDevice}
          onBack={() => setView("entry")}
          showDeviceControls={vaultState === "unlocked"}
          showDangerZone={vaultState === "unlocked"}
          emphasizeCoordinatorDetails={false}
        />
      </main>
    );
  }

  if (view === "secure") {
    return (
      <SecureDeviceStep
        busy={busy}
        error={error ?? vaultError}
        onCreateWithExistingPasskey={(displayName) =>
          secureDevice(onCreateWithExistingPasskey, displayName)
        }
        onCreateWithNewPasskey={(displayName) =>
          secureDevice(onCreateWithNewPasskey, displayName)
        }
        onBack={() => {
          if (busy) return;
          setPendingAction(null);
          setError(null);
          setView("entry");
        }}
      />
    );
  }

  return (
    <main className="project-empty-screen onboarding-entry-screen">
      <button
        className="onboarding-settings-button"
        type="button"
        aria-label="Settings"
        title="Settings"
        onClick={() => setView("settings")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      <section className="onboarding-entry">
        <header className="onboarding-entry-header">
          <div className="empty-floe" aria-hidden="true">
            ◆
          </div>
          <p className="settings-eyebrow">Floe Note</p>
          <h1>Local-first notes, across your devices</h1>
          <p>
            Write locally, sync directly between your devices, or bring in notes
            you already have.
          </p>
        </header>

        {error ? <p className="dialog-error" role="alert">{error}</p> : null}

        <div className="onboarding-primary-actions">
          <button
            className="onboarding-action-card onboarding-action-primary"
            type="button"
            disabled={busy}
            onClick={() => chooseAction("create")}
          >
            <span className="onboarding-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M7 3.5h7l4 4V20.5H7z" />
                <path d="M14 3.5v4h4" />
              </svg>
            </span>
            <span className="onboarding-action-copy">
              <strong>Start writing</strong>
              <small>Create your personal note space automatically.</small>
            </span>
            <span className="onboarding-action-arrow onboarding-action-arrow-circle" aria-hidden="true">
              →
            </span>
          </button>

          <button
            className="onboarding-action-card onboarding-action-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setJoinOpen(true);
            }}
          >
            <span className="onboarding-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="9" cy="8" r="3" />
                <circle cx="16.5" cy="9" r="2.5" />
                <path d="M3.5 19c.6-3.3 2.5-5 5.5-5s4.9 1.7 5.5 5" />
                <path d="M14 14.5c2.8-.2 4.8 1.3 5.5 4.5" />
              </svg>
            </span>
            <span className="onboarding-action-copy">
              <strong>Add this device</strong>
              <small>Use an invitation from another device.</small>
            </span>
            <span className="onboarding-action-arrow onboarding-action-arrow-circle" aria-hidden="true">
              →
            </span>
          </button>
        </div>

        <div className="onboarding-import-actions">
          <button
            className="onboarding-action-card onboarding-action-compact"
            type="button"
            onClick={() => chooseAction("import-floe")}
          >
            <span className="onboarding-action-icon onboarding-action-icon-compact" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 15V4" />
                <path d="m8 8 4-4 4 4" />
                <path d="M5 13.5v6h14v-6" />
              </svg>
            </span>
            <span className="onboarding-action-copy">
              <strong>Import Floe export</strong>
              <small>Create a Personal Workspace with the imported Project</small>
            </span>
            <span className="onboarding-action-arrow" aria-hidden="true">
              →
            </span>
          </button>

          <button
            className="onboarding-action-card onboarding-action-compact"
            type="button"
            onClick={() => chooseAction("import-markdown")}
          >
            <span className="onboarding-action-icon onboarding-action-icon-compact" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M3.5 6.5h6l2 2h9v10h-17z" />
              </svg>
            </span>
            <span className="onboarding-action-copy">
              <strong>Import Markdown directory</strong>
              <small>Create a Personal Workspace with one imported Project</small>
            </span>
            <span className="onboarding-action-arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </section>

      {joinOpen ? (
        <Modal
          labelledBy="empty-join-project-title"
          onClose={closeDialogs}
          disabled={busy}
        >
          <h2 id="empty-join-project-title">Add this device</h2>
          <p className="dialog-description">
            Paste an invitation link created on an authorized device.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              joinProject();
            }}
          >
            <label className="dialog-field">
              <span>Invitation link</span>
              <input
                autoFocus
                value={inviteUrl}
                disabled={busy}
                placeholder="https://…/join/v1/…#s=…"
                onChange={(event) => setInviteUrl(event.target.value)}
              />
            </label>
            {error ? <p className="dialog-error">{error}</p> : null}
            <div className="dialog-actions">
              <button
                className="dialog-secondary-button"
                type="button"
                disabled={busy}
                onClick={closeDialogs}
              >
                Cancel
              </button>
              <button
                className="dialog-primary-button"
                type="submit"
                disabled={busy || inviteUrl.trim().length === 0}
              >
                Continue
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {importOpen ? (
        <Modal
          labelledBy="empty-import-project-title"
          onClose={closeDialogs}
          disabled={busy}
        >
          <h2 id="empty-import-project-title">Import Floe export</h2>
          <p className="dialog-description">
            Select a portable .floe.zip export. Floe Note validates the entire
            archive first, then creates a new Personal Workspace containing only
            the imported Project and a fresh security identity.
          </p>
          <label className="dialog-field">
            <span>Floe export</span>
            <input
              autoFocus
              type="file"
              accept=".floe.zip,application/zip"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                if (file) void importFloeExport(file);
              }}
            />
          </label>
          <p className="settings-field-hint">
            {busy
              ? "Validating and creating a new Workspace…"
              : "The source Workspace identity, devices, and keys are not restored."}
          </p>
          {error ? <p className="dialog-error">{error}</p> : null}
          <div className="dialog-actions">
            <button
              className="dialog-secondary-button"
              type="button"
              disabled={busy}
              onClick={closeDialogs}
            >
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {markdownImportOpen ? (
        <Modal
          labelledBy="empty-import-markdown-title"
          onClose={closeDialogs}
          disabled={busy}
        >
          <h2 id="empty-import-markdown-title">Import Markdown directory</h2>
          <p className="dialog-description">
            Select a directory of Markdown files. Floe Note reads and validates
            all importable files before creating a new Personal Workspace with
            one Project. Nested directories are flattened.
          </p>
          <label className="dialog-field">
            <span>Markdown directory</span>
            <input
              autoFocus
              type="file"
              multiple
              disabled={busy}
              ref={(input) => {
                input?.setAttribute("webkitdirectory", "");
              }}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                if (files.length > 0) {
                  void importMarkdownDirectory(files);
                }
              }}
            />
          </label>
          <p className="settings-field-hint">
            {busy
              ? "Reading, validating, and creating a new Workspace…"
              : "Imports .md and .markdown files recursively. Hidden files and directories are ignored."}
          </p>
          {error ? <p className="dialog-error">{error}</p> : null}
          <div className="dialog-actions">
            <button
              className="dialog-secondary-button"
              type="button"
              disabled={busy}
              onClick={closeDialogs}
            >
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
