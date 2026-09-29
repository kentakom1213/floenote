import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { WorkspaceId } from "@floe-note/domain";

import { parseInvitationUrl } from "./invitation-url.js";
import { Modal } from "./Modal.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

export type ProjectSwitcherItem = {
  id: WorkspaceId;
  name: string;
  isCurrent: boolean;
};

type NewProjectSource =
  | "blank"
  | "invitation"
  | "floe-import"
  | "markdown-import";

type ProjectSwitcherProps = {
  projects: readonly ProjectSwitcherItem[];
  disabled?: boolean;
  onSelectProject: (projectId: WorkspaceId) => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
  onImportFloeExport: (archive: Uint8Array) => Promise<void>;
  onImportMarkdownDirectory: (files: readonly File[]) => Promise<void>;
};

export function ProjectSwitcher({
  projects,
  disabled = false,
  onSelectProject,
  onCreateProject,
  onImportFloeExport,
  onImportMarkdownDirectory,
}: ProjectSwitcherProps) {
  const current = projects.find((project) => project.isCurrent) ?? projects[0];
  const switcherRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(switcherRef);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectSource, setNewProjectSource] =
    useState<NewProjectSource | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [pendingWorkspaceId, setPendingWorkspaceId] =
    useState<WorkspaceId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectProject(projectId: WorkspaceId): Promise<void> {
    if (disabled || pendingWorkspaceId || projectId === current?.id) return;

    setPendingWorkspaceId(projectId);
    setError(null);

    try {
      await onSelectProject(projectId);
      switcherRef.current?.removeAttribute("open");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not open Workspace",
      );
    } finally {
      setPendingWorkspaceId(null);
    }
  }

  async function createProject(): Promise<void> {
    const name = newProjectName.trim();
    if (!name || busy) return;

    setBusy(true);
    setError(null);

    try {
      await onCreateProject(name);
      setNewProjectName("");
      setInviteUrl("");
      setNewProjectSource(null);
      setNewProjectOpen(false);
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
      setNewProjectSource(null);
      setNewProjectOpen(false);
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
      setNewProjectSource(null);
      setNewProjectOpen(false);
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

  function closeNewProject(): void {
    if (busy) return;

    setNewProjectOpen(false);
    setNewProjectSource(null);
    setNewProjectName("");
    setInviteUrl("");
    setError(null);
  }

  function returnToSourceSelection(): void {
    if (busy) return;

    setNewProjectSource(null);
    setNewProjectName("");
    setInviteUrl("");
    setError(null);
  }

  return (
    <>
      <details className="project-switcher" ref={switcherRef}>
        <summary
          className="project-switcher-trigger"
          aria-label={`Switch workspace, current ${current?.name ?? "Personal"}`}
        >
          <span className="floe-mark" aria-hidden="true">◆</span>
          <span className="project-switcher-copy">
            <span className="project-switcher-name">
              {current?.name ?? "Personal"}
            </span>
          </span>
        </summary>

        <div className="project-switcher-menu">
          <p className="project-switcher-menu-label">Workspaces</p>

          <div className="project-switcher-list">
            {projects.map((project) => (
              <button
                className="project-switcher-item"
                type="button"
                key={project.id}
                aria-current={project.isCurrent ? "page" : undefined}
                disabled={disabled || pendingWorkspaceId !== null}
                onClick={() => void selectProject(project.id)}
              >
                <span
                  className="project-switcher-check"
                  aria-hidden="true"
                >
                  {project.isCurrent ? "✓" : ""}
                </span>
                <span className="project-switcher-item-name">
                  {project.name}
                </span>
                {pendingWorkspaceId === project.id ? (
                  <span className="project-switcher-pending">…</span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="project-switcher-divider" />

          <button
            className="project-switcher-action"
            type="button"
            disabled={disabled}
            onClick={(event) => {
              event.currentTarget
                .closest("details")
                ?.removeAttribute("open");
              setError(null);
              setNewProjectOpen(true);
            }}
          >
            <span aria-hidden="true">＋</span>
            <span>New workspace</span>
          </button>

          {error && !newProjectOpen ? (
            <p className="project-switcher-error">{error}</p>
          ) : null}
        </div>
      </details>

      {newProjectOpen && typeof document !== "undefined" ? createPortal(
        <Modal
          labelledBy="new-project-title"
          disabled={busy}
          onClose={closeNewProject}
        >
          <h2 id="new-project-title">New workspace</h2>

          {newProjectSource === null ? (
            <>
              <p className="dialog-description">
                Choose how to add a Workspace to this device.
              </p>

              <div className="new-project-source-list">
                <button
                  className="new-project-source-option"
                  type="button"
                  autoFocus
                  onClick={() => setNewProjectSource("blank")}
                >
                  <strong>Blank workspace</strong>
                  <span>
                    Create a new Workspace and start with an empty note
                    space.
                  </span>
                </button>
                <button
                  className="new-project-source-option"
                  type="button"
                  onClick={() => setNewProjectSource("invitation")}
                >
                  <strong>Join with invitation link</strong>
                  <span>
                    Add an existing Workspace to this device using an invitation
                    from another authorized device.
                  </span>
                </button>
                <button
                  className="new-project-source-option"
                  type="button"
                  onClick={() => setNewProjectSource("floe-import")}
                >
                  <strong>Import Floe export</strong>
                  <span>
                    Create a new Personal Workspace with the imported Project.
                  </span>
                </button>
                <button
                  className="new-project-source-option"
                  type="button"
                  onClick={() => setNewProjectSource("markdown-import")}
                >
                  <strong>Import Markdown directory</strong>
                  <span>
                    Create a new Personal Workspace with one Project named from
                    the directory.
                  </span>
                </button>
              </div>

              <div className="dialog-actions">
                <button
                  className="dialog-secondary-button"
                  type="button"
                  onClick={closeNewProject}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : newProjectSource === "blank" ? (
            <>
              <p className="dialog-description">
                Create a new Workspace with a separate space for notes and
                devices.
              </p>

              <button
                className="new-project-source-back"
                type="button"
                disabled={busy}
                onClick={returnToSourceSelection}
              >
                ← Choose another source
              </button>

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
                    value={newProjectName}
                    maxLength={80}
                    placeholder="Research"
                    disabled={busy}
                    onChange={(event) => setNewProjectName(event.target.value)}
                  />
                </label>

                {error ? <p className="dialog-error">{error}</p> : null}

                <div className="dialog-actions">
                  <button
                    className="dialog-secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={closeNewProject}
                  >
                    Cancel
                  </button>
                  <button
                    className="dialog-primary-button"
                    type="submit"
                    disabled={busy || newProjectName.trim().length === 0}
                  >
                    {busy ? "Creating…" : "Create workspace"}
                  </button>
                </div>
              </form>
            </>
          ) : newProjectSource === "invitation" ? (
            <>
              <p className="dialog-description">
                Paste an invitation link created on an authorized device. This
                adds that existing Workspace to this device.
              </p>

              <button
                className="new-project-source-back"
                type="button"
                disabled={busy}
                onClick={returnToSourceSelection}
              >
                ← Choose another source
              </button>

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
                    onClick={closeNewProject}
                  >
                    Cancel
                  </button>
                  <button
                    className="dialog-primary-button"
                    type="submit"
                    disabled={busy || inviteUrl.trim().length === 0}
                  >
                    Join workspace
                  </button>
                </div>
              </form>
            </>
          ) : newProjectSource === "floe-import" ? (
            <>
              <p className="dialog-description">
                Choose a portable Floe Project export. This creates a new
                Workspace named Personal with only the imported Project and a
                fresh Workspace security identity.
              </p>

              <button
                className="new-project-source-back"
                type="button"
                disabled={busy}
                onClick={returnToSourceSelection}
              >
                ← Choose another source
              </button>

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
                  : "Select a .floe.zip file exported by Floe Note."}
              </p>

              {error ? <p className="dialog-error">{error}</p> : null}

              <div className="dialog-actions">
                <button
                  className="dialog-secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={closeNewProject}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="dialog-description">
                Choose a directory containing Markdown files. Floe Note reads
                and validates all importable files before creating a new
                Personal Workspace with one Project. Nested directories are
                flattened.
              </p>

              <button
                className="new-project-source-back"
                type="button"
                disabled={busy}
                onClick={returnToSourceSelection}
              >
                ← Choose another source
              </button>

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
                  onClick={closeNewProject}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </Modal>,
        document.body,
      ) : null}
    </>
  );
}
