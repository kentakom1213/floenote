import { useState } from "react";

import { parseInvitationUrl } from "./invitation-url.js";
import { Modal } from "./Modal.js";

type ProjectEmptyStateProps = {
  onCreateProject: (name: string) => Promise<void>;
  onImportFloeExport: (archive: Uint8Array) => Promise<void>;
  onImportMarkdownDirectory: (files: readonly File[]) => Promise<void>;
};

export function ProjectEmptyState({
  onCreateProject,
  onImportFloeExport,
  onImportMarkdownDirectory,
}: ProjectEmptyStateProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [markdownImportOpen, setMarkdownImportOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="project-empty-screen">
      <section className="project-empty-card">
        <div className="empty-floe" aria-hidden="true">
          ◆
        </div>
        <p className="settings-eyebrow">Floe Note</p>
        <h1>No Projects on this device</h1>
        <p>
          Create a new Project, join one from another authorized device, or
          import existing notes.
        </p>

        <div className="project-empty-actions">
          <button
            className="dialog-primary-button"
            type="button"
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
          >
            Create a project
          </button>
          <button
            className="dialog-secondary-button"
            type="button"
            onClick={() => {
              setError(null);
              setJoinOpen(true);
            }}
          >
            Join a project
          </button>
          <button
            className="dialog-secondary-button"
            type="button"
            onClick={() => {
              setError(null);
              setImportOpen(true);
            }}
          >
            Import Floe export
          </button>
          <button
            className="dialog-secondary-button"
            type="button"
            onClick={() => {
              setError(null);
              setMarkdownImportOpen(true);
            }}
          >
            Import Markdown directory
          </button>
        </div>
      </section>

      {createOpen ? (
        <Modal
          labelledBy="empty-create-project-title"
          onClose={closeDialogs}
          disabled={busy}
        >
          <h2 id="empty-create-project-title">Create a project</h2>
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
              <span>Name</span>
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
                {busy ? "Creating…" : "Create project"}
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
          <h2 id="empty-join-project-title">Join a project</h2>
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
                Join project
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
