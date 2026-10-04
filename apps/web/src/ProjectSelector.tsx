import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { WorkspaceProject } from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";

import { Modal } from "./Modal.js";
import { useDismissibleDetails } from "./useDismissibleDetails.js";

type ProjectSelectorProps = {
  projects: readonly WorkspaceProject[];
  selectedId: ProjectId | null;
  onSelect: (id: ProjectId) => void;
  onOpenSettings: (id: ProjectId) => void;
  onCreate: (name: string) => void;
  onImportFloeExport: (file: File) => Promise<void>;
  onImportMarkdownDirectory: (files: readonly File[]) => Promise<void>;
  onReopen: (id: ProjectId) => void;
};

export function ProjectSelector({
  projects,
  selectedId,
  onSelect,
  onOpenSettings,
  onCreate,
  onImportFloeExport,
  onImportMarkdownDirectory,
  onReopen,
}: ProjectSelectorProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(menuRef);
  const [dialog, setDialog] = useState<
    | "create"
    | "create-blank"
    | "import"
    | "import-floe"
    | "import-markdown"
    | "archived"
    | null
  >(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = projects.filter((project) => project.status === "active");
  const archived = projects.filter((project) => project.status === "archived");
  const selected = active.find((project) => project.id === selectedId);
  function openDialog(next: typeof dialog): void {
    menuRef.current?.removeAttribute("open");
    setName("");
    setError(null);
    setDialog(next);
  }

  function submitName(): void {
    try {
      if (dialog === "create-blank") onCreate(name);
      setError(null);
      setDialog(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save Project",
      );
    }
  }

  async function importFloe(file: File): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onImportFloeExport(file);
      setDialog(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not import Floe export",
      );
    } finally {
      setBusy(false);
    }
  }

  async function importMarkdown(files: readonly File[]): Promise<void> {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onImportMarkdownDirectory(files);
      setDialog(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not import Markdown directory",
      );
    } finally {
      setBusy(false);
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
          <ChevronDownIcon />
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
              New / Import Project…
            </span>
          </button>
          {selected ? (
            <button
              className="workspace-project-menu-item"
              type="button"
              data-settings-entry
              onClick={() => {
                menuRef.current?.removeAttribute("open");
                onOpenSettings(selected.id);
              }}
            >
              <span className="workspace-project-action">
                <ManageIcon />
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
            New / Import Project
          </button>
          <button type="button" onClick={() => openDialog("archived")}>
            Reopen archived Project
          </button>
        </div>
      ) : null}

      {dialog && typeof document !== "undefined" ? createPortal(
        <Modal
          labelledBy="project-dialog-title"
          disabled={busy}
          onClose={() => setDialog(null)}
        >
          <h2 id="project-dialog-title">
            {dialog === "create"
              ? "New / Import Project"
              : dialog === "create-blank"
                ? "Blank Project"
                : dialog === "import"
                  ? "Import Project"
                  : dialog === "import-floe"
                    ? "Import Floe export"
                    : dialog === "import-markdown"
                      ? "Import Markdown directory"
                      : "Archived projects"}
          </h2>
          {dialog === "create" ? (
            <>
              <p className="dialog-description">
                Add a new Project to this Workspace.
              </p>
              <div className="new-project-source-list">
                <button
                  className="new-project-source-option project-source-option project-source-option-primary"
                  type="button"
                  autoFocus
                  onClick={() => openDialog("create-blank")}
                >
                  <PlusIcon />
                  <span className="project-source-copy">
                    <strong>Blank Project</strong>
                    <span>Start an empty Project in this Workspace.</span>
                  </span>
                </button>
                <button
                  className="new-project-source-option project-source-option"
                  type="button"
                  onClick={() => openDialog("import")}
                >
                  <ImportIcon />
                  <span className="project-source-copy">
                    <strong>Import…</strong>
                    <span>Add a Project from a Floe export or Markdown directory.</span>
                  </span>
                </button>
              </div>
            </>
          ) : dialog === "import" ? (
            <>
              <p className="dialog-description">
                Add a new Project to this Workspace from an export or a directory.
              </p>
              <div className="new-project-source-list">
                <button
                  className="new-project-source-option project-source-option"
                  type="button"
                  autoFocus
                  onClick={() => openDialog("import-floe")}
                >
                  <FloeExportIcon />
                  <span className="project-source-copy">
                    <strong>Import Floe export</strong>
                    <span>Add a portable Project from a .floe.zip archive.</span>
                  </span>
                </button>
                <button
                  className="new-project-source-option project-source-option"
                  type="button"
                  onClick={() => openDialog("import-markdown")}
                >
                  <FolderIcon />
                  <span className="project-source-copy">
                    <strong>Import Markdown directory</strong>
                    <span>Add one Project from a folder of Markdown files.</span>
                  </span>
                </button>
              </div>
              <div className="dialog-actions">
                <button
                  className="dialog-secondary-button"
                  type="button"
                  onClick={() => openDialog("create")}
                >
                  Back
                </button>
              </div>
            </>
          ) : dialog === "import-floe" || dialog === "import-markdown" ? (
            <>
              <p className="dialog-description">
                Create a new Project in this Workspace from{" "}
                {dialog === "import-floe"
                  ? "a portable .floe.zip export"
                  : "a Markdown directory"}.
                {dialog === "import-markdown"
                  ? " Nested directories are flattened."
                  : ""}
              </p>
              <label className="dialog-field">
                <span>
                  {dialog === "import-floe" ? "Floe export" : "Markdown directory"}
                </span>
                <input
                  autoFocus
                  type="file"
                  multiple={dialog === "import-markdown"}
                  accept={
                    dialog === "import-floe"
                      ? ".floe.zip,application/zip"
                      : undefined
                  }
                  disabled={busy}
                  ref={(input) => {
                    if (dialog === "import-markdown") {
                      input?.setAttribute("webkitdirectory", "");
                    }
                  }}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    if (dialog === "import-floe" && files[0]) {
                      void importFloe(files[0]);
                    } else if (dialog === "import-markdown") {
                      void importMarkdown(files);
                    }
                  }}
                />
              </label>
              {error ? <p className="dialog-error" role="alert">{error}</p> : null}
              <div className="dialog-actions">
                <button
                  className="dialog-secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => openDialog("import")}
                >
                  Back
                </button>
              </div>
            </>
          ) : dialog === "create-blank" ? (
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
                    Create Project
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              {archived.length === 0 ? (
                <p>No archived Projects.</p>
              ) : (
                archived.map((project) => (
                  <div className="archived-project-row" key={project.id}>
                    <span>{project.name}</span>
                    <button
                      className="dialog-secondary-button"
                      type="button"
                      onClick={() => {
                        onReopen(project.id);
                        setDialog(null);
                      }}
                    >
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
        </Modal>,
        document.body,
      ) : null}
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      className="workspace-project-chevron"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="m6.5 8 3.5 3.5L13.5 8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.5v13M3.5 10h13" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5v10m-3-3 3 3 3-3M3.5 13.5v3h13v-3" />
    </svg>
  );
}

function FloeExportIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2.5h7l3 3v12H5zM12 2.5v3h3M7.5 9h5M7.5 12h5M7.5 15h3" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.5 5h5l1.5 2h8.5v9.5h-15zM2.5 7h15" />
    </svg>
  );
}

function ManageIcon() {
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
