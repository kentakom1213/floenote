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
  onCreateWithExistingPasskey: (displayName: string) => Promise<void>;
  onCreateWithNewPasskey: (displayName: string) => Promise<void>;
  onRenameDevice: (displayName: string) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => void;
  onEraseDevice: () => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
  onImportFloeExport: (archive: Uint8Array) => Promise<void>;
  onImportMarkdownDirectory: (files: readonly File[]) => Promise<void>;
};

type OnboardingView = "entry" | "settings" | "secure";

export function ProjectEmptyState({
  vaultState,
  vaultError,
  theme,
  coordinatorBaseUrl,
  localDeviceId,
  localDeviceName,
  onCreateWithExistingPasskey,
  onCreateWithNewPasskey,
  onRenameDevice,
  onThemeChange,
  onEraseDevice,
  onCreateProject,
  onImportFloeExport,
  onImportMarkdownDirectory,
}: ProjectEmptyStateProps) {
  const [view, setView] = useState<OnboardingView>("entry");
  const [pendingAction, setPendingAction] = useState<OnboardingAction | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [markdownImportOpen, setMarkdownImportOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAction(action: OnboardingAction): void {
    if (action === "create") setCreateOpen(true);
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
      openAction(action);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not secure this device",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createProject(): Promise<void> {
    const name = projectName.trim();
    if (!name || busy) return;

    setBusy(true);
    setError(null);
    try {
      await onCreateProject(name);
      setProjectName("");
      setCreateOpen(false);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not create Project",
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
    setCreateOpen(false);
    setJoinOpen(false);
    setImportOpen(false);
    setMarkdownImportOpen(false);
    setProjectName("");
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
          onRenameDevice={onRenameDevice}
          onThemeChange={onThemeChange}
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
          <path d="M12 8.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z" />
          <path d="M19.14 12.94a7.6 7.6 0 0 0 .05-.94 7.6 7.6 0 0 0-.05-.94l2.02-1.58-1.9-3.29-2.38.96a7.1 7.1 0 0 0-1.63-.94L14.9 3.7h-3.8l-.36 2.51c-.58.25-1.12.56-1.62.94l-2.39-.96-1.9 3.29 2.03 1.58a7.6 7.6 0 0 0-.06.94c0 .32.02.63.06.94l-2.03 1.58 1.9 3.29 2.39-.96c.5.38 1.04.69 1.62.94l.36 2.51h3.8l.35-2.51a7.1 7.1 0 0 0 1.63-.94l2.38.96 1.9-3.29-2.02-1.58Z" />
        </svg>
      </button>

      <section className="onboarding-entry">
        <header className="onboarding-entry-header">
          <div className="empty-floe" aria-hidden="true">
            ◆
          </div>
          <p className="settings-eyebrow">Floe Note</p>
          <h1>Choose how to begin</h1>
          <p>
            Create a new Project, join one from another device, or import
            existing notes.
          </p>
        </header>

        <div className="onboarding-action-grid">
          <button
            className="onboarding-action-card onboarding-action-primary"
            type="button"
            onClick={() => chooseAction("create")}
          >
            <span className="onboarding-action-icon" aria-hidden="true">
              +
            </span>
            <span>
              <strong>Create a Project</strong>
              <small>Start a new space for your notes.</small>
            </span>
            <span className="onboarding-action-arrow" aria-hidden="true">
              →
            </span>
          </button>

          <button
            className="onboarding-action-card onboarding-action-secondary"
            type="button"
            onClick={() => {
              setError(null);
              setJoinOpen(true);
            }}
          >
            <span className="onboarding-action-icon" aria-hidden="true">
              ↗
            </span>
            <span>
              <strong>Join a Project</strong>
              <small>Connect another authorized device.</small>
            </span>
            <span className="onboarding-action-arrow" aria-hidden="true">
              →
            </span>
          </button>

          <button
            className="onboarding-action-card onboarding-action-compact"
            type="button"
            onClick={() => chooseAction("import-floe")}
          >
            <span>
              <strong>Import Floe export</strong>
              <small>Import a portable .floe.zip archive</small>
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
            <span>
              <strong>Import Markdown directory</strong>
              <small>Import a folder of Markdown files</small>
            </span>
            <span className="onboarding-action-arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </section>

      {createOpen ? (
        <Modal
          labelledBy="empty-create-project-title"
          onClose={closeDialogs}
          disabled={busy}
        >
          <h2 id="empty-create-project-title">Create a Project</h2>
          <p className="dialog-description">
            Create a separate local-first space for notes and devices.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createProject();
            }}
          >
            <label className="dialog-field">
              <span>Project name</span>
              <input
                autoFocus
                value={projectName}
                maxLength={80}
                disabled={busy}
                placeholder="Research"
                onChange={(event) => setProjectName(event.target.value)}
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
                disabled={busy || projectName.trim().length === 0}
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {joinOpen ? (
        <Modal
          labelledBy="empty-join-project-title"
          onClose={closeDialogs}
          disabled={busy}
        >
          <h2 id="empty-join-project-title">Join a Project</h2>
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
            archive first, then creates a new independent Project identity.
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
              ? "Validating and creating a new Project…"
              : "The source Project identity, devices, and keys are not restored."}
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
            all importable files before creating a new independent Project.
            Nested directories are flattened.
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
              ? "Reading, validating, and creating a new Project…"
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
