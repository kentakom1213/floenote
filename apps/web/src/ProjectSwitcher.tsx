import { useState } from "react";

import type { ProjectId } from "@floe-note/domain";

export type ProjectSwitcherItem = {
  id: ProjectId;
  name: string;
  isCurrent: boolean;
};

type ProjectSwitcherProps = {
  projects: readonly ProjectSwitcherItem[];
  disabled?: boolean;
  onSelectProject: (projectId: ProjectId) => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
};

export function ProjectSwitcher({
  projects,
  disabled = false,
  onSelectProject,
  onCreateProject,
}: ProjectSwitcherProps) {
  const current = projects.find((project) => project.isCurrent) ?? projects[0];
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingProjectId, setPendingProjectId] =
    useState<ProjectId | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectProject(projectId: ProjectId): Promise<void> {
    if (disabled || pendingProjectId || projectId === current?.id) return;

    setPendingProjectId(projectId);
    setError(null);

    try {
      await onSelectProject(projectId);
      document
        .querySelector<HTMLDetailsElement>(".project-switcher[open]")
        ?.removeAttribute("open");
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
    if (!name || creating) return;

    setCreating(true);
    setError(null);

    try {
      await onCreateProject(name);
      setNewProjectName("");
      setNewProjectOpen(false);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not create Project",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <details className="project-switcher">
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

          {error && !newProjectOpen ? (
            <p className="project-switcher-error">{error}</p>
          ) : null}
        </div>
      </details>

      {newProjectOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creating) {
              setNewProjectOpen(false);
            }
          }}
        >
          <section
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
          >
            <h2 id="new-project-title">New project</h2>
            <p className="dialog-description">
              Create a separate space for a set of notes and devices.
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
                  value={newProjectName}
                  maxLength={80}
                  placeholder="Research"
                  disabled={creating}
                  onChange={(event) => setNewProjectName(event.target.value)}
                />
              </label>

              {error ? <p className="dialog-error">{error}</p> : null}

              <div className="dialog-actions">
                <button
                  className="dialog-secondary-button"
                  type="button"
                  disabled={creating}
                  onClick={() => {
                    setError(null);
                    setNewProjectOpen(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="dialog-primary-button"
                  type="submit"
                  disabled={creating || newProjectName.trim().length === 0}
                >
                  {creating ? "Creating…" : "Create project"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
