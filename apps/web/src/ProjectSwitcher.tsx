import { useRef, useState } from "react";

import type { ProjectId } from "@floe-note/domain";

import { parseInvitationUrl } from "./invitation-url.js";
import { Modal } from "./Modal.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

export type ProjectSwitcherItem = {
  id: ProjectId;
  name: string;
  isCurrent: boolean;
};

type NewProjectSource = "blank" | "invitation";

type ProjectSwitcherProps = {
  projects: readonly ProjectSwitcherItem[];
  disabled?: boolean;
  onSelectProject: (projectId: ProjectId) => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
  onOpenProjectSettings: () => void;
};

export function ProjectSwitcher({
  projects,
  disabled = false,
  onSelectProject,
  onCreateProject,
  onOpenProjectSettings,
}: ProjectSwitcherProps) {
  const current = projects.find((project) => project.isCurrent) ?? projects[0];
  const switcherRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(switcherRef);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectSource, setNewProjectSource] =
    useState<NewProjectSource | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [pendingProjectId, setPendingProjectId] =
    useState<ProjectId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectProject(projectId: ProjectId): Promise<void> {
    if (disabled || pendingProjectId || projectId === current?.id) return;

    setPendingProjectId(projectId);
    setError(null);

    try {
      await onSelectProject(projectId);
      switcherRef.current?.removeAttribute("open");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not open Project",
      );
    } finally {
      setPendingProjectId(null);
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
          aria-label="Switch project"
        >
          <span className="project-switcher-copy">
            <span className="project-switcher-label">Project</span>
            <span className="project-switcher-name">
              {current?.name ?? "Personal"}
            </span>
          </span>
          <span className="project-switcher-chevron" aria-hidden="true">
            ▾
          </span>
        </summary>

        <div className="project-switcher-menu">
          <p className="project-switcher-menu-label">Projects</p>

          <div className="project-switcher-list">
            {projects.map((project) => (
              <button
                className="project-switcher-item"
                type="button"
                key={project.id}
                disabled={disabled || pendingProjectId !== null}
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
                {pendingProjectId === project.id ? (
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
            <span>New project</span>
          </button>

          <button
            className="project-switcher-action"
            type="button"
            disabled={disabled}
            onClick={() => {
              switcherRef.current?.removeAttribute("open");
              onOpenProjectSettings();
            }}
          >
            <span aria-hidden="true">⚙</span>
            <span>Project settings</span>
          </button>

          {error && !newProjectOpen ? (
            <p className="project-switcher-error">{error}</p>
          ) : null}
        </div>
      </details>

      {newProjectOpen ? (
        <Modal
          labelledBy="new-project-title"
          disabled={busy}
          onClose={closeNewProject}
        >
          <h2 id="new-project-title">New project</h2>

          {newProjectSource === null ? (
            <>
              <p className="dialog-description">
                Choose how to add a Project to this device.
              </p>

              <div className="new-project-source-list">
                <button
                  className="new-project-source-option"
                  type="button"
                  autoFocus
                  onClick={() => setNewProjectSource("blank")}
                >
                  <strong>Blank project</strong>
                  <span>
                    Create a new Project identity and start with an empty note
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
                    Add an existing Project to this device using an invitation
                    from another authorized device.
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
                Create a new Project identity and a separate space for notes and
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
                    {busy ? "Creating…" : "Create project"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <p className="dialog-description">
                Paste an invitation link created on an authorized device. This
                adds that existing Project to this device.
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
                    Join project
                  </button>
                </div>
              </form>
            </>
          )}
        </Modal>
      ) : null}
    </>
  );
}
