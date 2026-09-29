import { useRef, useState } from "react";

import type { WorkspaceProject } from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";

import { Modal } from "./Modal.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

type ProjectSelectorProps = {
  projects: readonly WorkspaceProject[];
  selectedId: ProjectId | null;
  activeNoteCounts: ReadonlyMap<ProjectId, number>;
  onSelect: (id: ProjectId) => void;
  onCreate: (name: string) => void;
  onRename: (id: ProjectId, name: string) => void;
  onArchive: (id: ProjectId) => void;
  onReopen: (id: ProjectId) => void;
};

export function ProjectSelector({
  projects,
  selectedId,
  activeNoteCounts,
  onSelect,
  onCreate,
  onRename,
  onArchive,
  onReopen,
}: ProjectSelectorProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menuRef);
  const [dialog, setDialog] = useState<
    "create" | "settings" | "archive" | "archived" | null
  >(null);
  const [dialogProjectId, setDialogProjectId] = useState<ProjectId | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const active = projects.filter((project) => project.status === "active");
  const archived = projects.filter((project) => project.status === "archived");
  const selected = active.find((project) => project.id === selectedId);
  const dialogProject = projects.find(
    (project) => project.id === dialogProjectId,
  );

  function openDialog(next: typeof dialog, project?: WorkspaceProject): void {
    menuRef.current?.removeAttribute("open");
    setDialogProjectId(project?.id ?? null);
    setName(next === "settings" ? project?.name ?? "" : "");
    setError(null);
    setDialog(next);
  }

  function submitName(): void {
    try {
      if (dialog === "create") {
        onCreate(name);
        setDialog(null);
      } else if (dialog === "settings" && dialogProject) {
        onRename(dialogProject.id, name);
      }
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save Project",
      );
    }
  }

  return (
    <div className="workspace-project-control">
      <details className="workspace-project-selector" ref={menuRef}>
        <summary
          className="workspace-project-trigger"
          aria-label={`Switch Project, current ${selected?.name ?? "None"}`}
        >
          <span>{selected?.name ?? "No active Project"}</span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="workspace-project-menu">
          <p className="project-switcher-menu-label">Projects</p>
          {active.map((project) => (
            <button
              key={project.id}
              type="button"
              className="workspace-project-menu-item"
              aria-current={project.id === selectedId ? "true" : undefined}
              onClick={() => {
                menuRef.current?.removeAttribute("open");
                onSelect(project.id);
              }}
            >
              <span>{project.name}</span>
              {project.id === selectedId ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
          <div className="project-switcher-divider" />
          <button
            className="workspace-project-menu-item"
            type="button"
            onClick={() => openDialog("create")}
          >
            <span className="workspace-project-action">
              <PlusIcon />
              New Project…
            </span>
          </button>
          {selected ? (
            <button
              className="workspace-project-menu-item"
              type="button"
              onClick={() => openDialog("settings", selected)}
            >
              <span className="workspace-project-action">
                <SettingsIcon />
                Project settings…
              </span>
            </button>
          ) : null}
          <button
            className="workspace-project-menu-item"
            type="button"
            onClick={() => openDialog("archived")}
          >
            <span className="workspace-project-action">
              <ArchiveIcon />
              Archived projects…
            </span>
          </button>
        </div>
      </details>

      {active.length === 0 ? (
        <div className="zero-project-actions">
          <button type="button" onClick={() => openDialog("create")}>
            Create Project
          </button>
          <button type="button" onClick={() => openDialog("archived")}>
            Reopen archived Project
          </button>
        </div>
      ) : null}

      {dialog ? (
        <Modal labelledBy="project-dialog-title" onClose={() => setDialog(null)}>
          <h2 id="project-dialog-title">
            {dialog === "create"
              ? "New Project"
              : dialog === "settings"
                ? "Project settings"
                : dialog === "archive"
                  ? "Archive Project"
                  : "Archived projects"}
          </h2>
          {dialog === "create" || (dialog === "settings" && dialogProject) ? (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitName();
                }}
              >
                <label className="dialog-field" htmlFor="project-name">
                  Project name
                  <input
                    id="project-name"
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                {error ? (
                  <p className="dialog-error" role="alert">{error}</p>
                ) : null}
                <div className="dialog-actions">
                  <button
                    className="dialog-secondary-button"
                    type="button"
                    onClick={() => setDialog(null)}
                  >
                    Cancel
                  </button>
                  <button className="dialog-primary-button" type="submit">
                    {dialog === "create" ? "Create Project" : "Save name"}
                  </button>
                </div>
              </form>
              {dialog === "settings" && dialogProject ? (
                <section className="project-settings-archive">
                  <h3>Archive Project</h3>
                  <p>
                    {activeNoteCounts.get(dialogProject.id)
                      ? "Move or delete this Project's active Notes before archiving it."
                      : "Archived Projects can be reopened later."}
                  </p>
                  <button
                    className="dialog-secondary-button"
                    type="button"
                    disabled={(activeNoteCounts.get(dialogProject.id) ?? 0) > 0}
                    onClick={() => openDialog("archive", dialogProject)}
                  >
                    <ArchiveIcon />
                    Archive Project…
                  </button>
                </section>
              ) : null}
            </>
          ) : dialog === "archive" && dialogProject ? (
            <>
              <p>Archive {dialogProject.name}? You can reopen it later.</p>
              {error ? <p className="dialog-error" role="alert">{error}</p> : null}
              <div className="dialog-actions">
                <button className="dialog-secondary-button" type="button" onClick={() => openDialog("settings", dialogProject)}>
                  Cancel
                </button>
                <button
                  className="dialog-primary-button"
                  type="button"
                  onClick={() => {
                    try {
                      onArchive(dialogProject.id);
                      setDialog(null);
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : "Could not archive Project");
                    }
                  }}
                >
                  Archive Project
                </button>
              </div>
            </>
          ) : (
            <>
              {archived.length === 0 ? (
                <p>No archived Projects.</p>
              ) : (
                archived.map((project) => (
                  <div className="archived-project-row" key={project.id}>
                    <span>{project.name}</span>
                    <button type="button" onClick={() => { onReopen(project.id); setDialog(null); }}>
                      Reopen
                    </button>
                  </div>
                ))
              )}
              <div className="dialog-actions">
                <button className="dialog-secondary-button" type="button" onClick={() => setDialog(null)}>
                  Close
                </button>
              </div>
            </>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.5v13M3.5 10h13" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M8.4 2.5h3.2l.5 1.9 1.4.8 1.9-.5 1.6 2.8-1.4 1.4v1.6l1.4 1.4-1.6 2.8-1.9-.5-1.4.8-.5 1.9H8.4l-.5-1.9-1.4-.8-1.9.5L3 11.9l1.4-1.4V8.9L3 7.5l1.6-2.8 1.9.5 1.4-.8z" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="4" width="14" height="3" rx="1" />
      <path d="M4.5 7v9h11V7M8 10.5h4" />
    </svg>
  );
}
