import { useEffect, useState, type ReactNode } from "react";

import type { WorkspaceProject } from "@floe-note/document";

import { ConfirmDialog } from "./ConfirmDialog.js";

type ProjectSettingsViewProps = {
  project: WorkspaceProject;
  activeNoteCount: number;
  onRename: (name: string) => void;
  onExport: () => void;
  onArchive: () => Promise<void>;
  scopeNavigation: ReactNode;
};

export function ProjectSettingsView({
  project,
  activeNoteCount,
  onRename,
  onExport,
  onArchive,
  scopeNavigation,
}: ProjectSettingsViewProps) {
  const [nameDraft, setNameDraft] = useState(project.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const normalizedName = nameDraft.trim();
  const nameChanged =
    normalizedName.length > 0 && normalizedName !== project.name;

  useEffect(() => {
    setNameDraft(project.name);
    setNameError(null);
    setExportError(null);
    setExported(false);
    setArchiveOpen(false);
  }, [project.id, project.name]);

  function saveName(): void {
    if (!nameChanged) return;
    try {
      onRename(normalizedName);
      setNameError(null);
    } catch (caught) {
      setNameError(
        caught instanceof Error ? caught.message : "Could not rename Project",
      );
    }
  }

  function exportProject(): void {
    try {
      onExport();
      setExportError(null);
      setExported(true);
    } catch (caught) {
      setExportError(
        caught instanceof Error ? caught.message : "Could not export Project",
      );
    }
  }

  return (
    <section className="settings-view">
      <header className="settings-header">
        <p className="settings-eyebrow">Settings · Project</p>
        <h1>{project.name}</h1>
      </header>

      {scopeNavigation}

      <div className="settings-section">
        <h2>Project</h2>
        <form
          className="settings-form-row"
          onSubmit={(event) => {
            event.preventDefault();
            saveName();
          }}
        >
          <label className="settings-field">
            <span>Project name</span>
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          <button
            className="settings-primary-action"
            type="submit"
            disabled={!nameChanged}
          >
            Save
          </button>
        </form>
        {nameError ? (
          <p className="dialog-error" role="alert">{nameError}</p>
        ) : null}
      </div>

      <div className="settings-section">
        <h2>Export Project</h2>
        <p className="settings-field-hint">
          Download this Project as a portable archive with readable Markdown.
          This is not an encrypted Workspace backup.
        </p>
        <button
          className="settings-primary-action project-settings-action"
          type="button"
          onClick={exportProject}
        >
          Export Project
        </button>
        {exported ? <p role="status">Project exported.</p> : null}
        {exportError ? (
          <p className="dialog-error" role="alert">{exportError}</p>
        ) : null}
      </div>

      <div className="settings-section danger-zone">
        <h2>Archive Project</h2>
        <p className="settings-field-hint">
          {activeNoteCount > 0
            ? "Move or delete this Project's active Notes before archiving it."
            : "Archived Projects can be reopened later."}
        </p>
        <button
          className="settings-danger-outline-action project-settings-action"
          type="button"
          disabled={activeNoteCount > 0}
          onClick={() => setArchiveOpen(true)}
        >
          Archive Project…
        </button>
      </div>

      {archiveOpen ? (
        <ConfirmDialog
          title={`Archive ${project.name}?`}
          description={<p>You can reopen it later.</p>}
          confirmLabel="Archive Project"
          onConfirm={onArchive}
          onClose={() => setArchiveOpen(false)}
        />
      ) : null}
    </section>
  );
}
